param([Parameter(Mandatory = $true)][string]$Request)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

try {
  $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Request))
  $requestData = $decoded | ConvertFrom-Json
  $names = @($requestData.PSObject.Properties.Name | Sort-Object)
  if (($names -join ',') -ne 'arguments,cwd,directories,executable,executableSha256,resource,resourceSha256') {
    throw 'invalid request'
  }
  foreach ($value in @($requestData.executable, $requestData.resource, $requestData.cwd) + @($requestData.directories)) {
    if (-not [IO.Path]::IsPathRooted([string]$value)) { throw 'invalid path' }
  }
  foreach ($hash in @($requestData.executableSha256, $requestData.resourceSha256)) {
    if ([string]$hash -notmatch '^[0-9a-f]{64}$') { throw 'invalid hash' }
  }

  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

public static class OksLockedJobLauncher {
  const uint CREATE_SUSPENDED = 0x4, EXTENDED_STARTUPINFO_PRESENT = 0x00080000, STARTF_USESTDHANDLES = 0x100;
  const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000, FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
  const uint GENERIC_READ = 0x80000000, OPEN_EXISTING = 3;
  const uint INFINITE = 0xffffffff, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x400, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
  const int JobObjectBasicAccountingInformation = 1, JobObjectExtendedLimitInformation = 9, PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x0002000D;

  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION {
    public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO {
    public int cb;
    public string lpReserved, lpDesktop, lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute;
    public uint dwFlags;
    public short wShowWindow, cbReserved2;
    public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX {
    public STARTUPINFO StartupInfo;
    public IntPtr lpAttributeList;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION {
    public IntPtr hProcess, hThread;
    public uint dwProcessId, dwThreadId;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern SafeFileHandle CreateFile(string name, uint access, FileShare share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string cwd, ref STARTUPINFOEX startup, out PROCESS_INFORMATION information);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnSize);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, uint length, IntPtr returnedLength);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int number);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);

  static void Require(bool value) { if (!value) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
  static string Hash(FileStream stream) {
    using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
  }
  static string Quote(string value) {
    if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return value;
    var result = new StringBuilder("\""); int slashes = 0;
    foreach (char current in value) {
      if (current == '\\') { slashes++; continue; }
      if (current == '"') result.Append('\\', slashes * 2 + 1).Append('"');
      else result.Append('\\', slashes).Append(current);
      slashes = 0;
    }
    return result.Append('\\', slashes * 2).Append('"').ToString();
  }
  static SafeFileHandle LockDirectory(string directory) {
    var handle = CreateFile(directory, 0, FileShare.Read | FileShare.Write, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
    if (handle.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    var attributes = File.GetAttributes(directory);
    if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != FileAttributes.Directory) throw new InvalidDataException();
    return handle;
  }
  static FileStream LockFile(string file) {
    var handle = CreateFile(file, GENERIC_READ, FileShare.Read, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
    if (handle.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    var attributes = File.GetAttributes(file);
    if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) { handle.Dispose(); throw new InvalidDataException(); }
    return new FileStream(handle, FileAccess.Read);
  }

  public static int Run(string executable, string[] arguments, string executableHash, string resource, string resourceHash, string cwd, string[] directories) {
    var heldDirectories = new List<SafeFileHandle>(); IntPtr attributes = IntPtr.Zero, attributesSize = IntPtr.Zero, job = IntPtr.Zero, jobValue = IntPtr.Zero, process = IntPtr.Zero, thread = IntPtr.Zero;
    FileStream executableFile = null, resourceFile = null;
    bool attributesInitialized = false, jobAssigned = false, jobDrained = false;
    try {
      foreach (string directory in directories) heldDirectories.Add(LockDirectory(directory));
      executableFile = LockFile(executable); resourceFile = LockFile(resource);
      if (Hash(executableFile) != executableHash || Hash(resourceFile) != resourceHash) throw new InvalidDataException();
      job = CreateJobObject(IntPtr.Zero, null); Require(job != IntPtr.Zero);
      var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      Require(SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, (uint)Marshal.SizeOf(limits)));
      InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributesSize);
      if (attributesSize == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      attributes = Marshal.AllocHGlobal(attributesSize);
      Require(InitializeProcThreadAttributeList(attributes, 1, 0, ref attributesSize)); attributesInitialized = true;
      jobValue = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobValue, job);
      Require(UpdateProcThreadAttribute(attributes, 0, new IntPtr(PROC_THREAD_ATTRIBUTE_JOB_LIST), jobValue, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
      var startup = new STARTUPINFOEX { lpAttributeList = attributes };
      startup.StartupInfo = new STARTUPINFO { cb = Marshal.SizeOf(typeof(STARTUPINFOEX)), dwFlags = STARTF_USESTDHANDLES, hStdInput = GetStdHandle(-10), hStdOutput = GetStdHandle(-11), hStdError = GetStdHandle(-12) };
      Require(SetHandleInformation(startup.StartupInfo.hStdInput, 1, 1) && SetHandleInformation(startup.StartupInfo.hStdOutput, 1, 1) && SetHandleInformation(startup.StartupInfo.hStdError, 1, 1));
      var command = new StringBuilder(Quote(executable));
      foreach (string argument in arguments) command.Append(' ').Append(Quote(argument));
      PROCESS_INFORMATION information;
      Require(CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, cwd, ref startup, out information));
      jobAssigned = true; process = information.hProcess; thread = information.hThread;
      if (Environment.GetEnvironmentVariable("OKS_LOCKED_JOB_TEST_POST_CREATE_FAILURE") == "1") throw new InvalidOperationException();
      var pauseMarker = Environment.GetEnvironmentVariable("OKS_LOCKED_JOB_TEST_POST_CREATE_PAUSE_MARKER");
      if (!String.IsNullOrEmpty(pauseMarker)) { File.WriteAllText(pauseMarker, information.dwProcessId.ToString()); Thread.Sleep(30000); }
      if (ResumeThread(thread) == 0xffffffff) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      CloseHandle(thread); thread = IntPtr.Zero;
      Require(WaitForSingleObject(process, INFINITE) == 0);
      uint exitCode; Require(GetExitCodeProcess(process, out exitCode));
      if (Environment.GetEnvironmentVariable("OKS_LOCKED_JOB_TEST_DRAIN_FAILURE") == "1") throw new InvalidOperationException();
      var accounting = new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
      do {
        Require(QueryInformationJobObject(job, JobObjectBasicAccountingInformation, ref accounting, (uint)Marshal.SizeOf(accounting), IntPtr.Zero));
        if (accounting.ActiveProcesses != 0) Thread.Sleep(25);
      } while (accounting.ActiveProcesses != 0);
      jobDrained = true;
      return unchecked((int)exitCode);
    } finally {
      bool cleanupFailed = false;
      if (jobAssigned && !jobDrained) {
        if (!TerminateJobObject(job, 190)) cleanupFailed = true;
        var accounting = new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
        for (int attempt = 0; attempt < 200; attempt++) {
          if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, ref accounting, (uint)Marshal.SizeOf(accounting), IntPtr.Zero)) { cleanupFailed = true; break; }
          if (accounting.ActiveProcesses == 0) break;
          Thread.Sleep(25);
        }
        if (accounting.ActiveProcesses != 0) cleanupFailed = true;
      }
      if (thread != IntPtr.Zero) CloseHandle(thread);
      if (process != IntPtr.Zero) CloseHandle(process);
      if (attributesInitialized) DeleteProcThreadAttributeList(attributes);
      if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
      if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
      if (job != IntPtr.Zero) CloseHandle(job);
      if (resourceFile != null) resourceFile.Dispose();
      if (executableFile != null) executableFile.Dispose();
      for (int index = heldDirectories.Count - 1; index >= 0; index--) heldDirectories[index].Dispose();
      if (cleanupFailed) throw new InvalidOperationException();
    }
  }
}
'@

  $arguments = [string[]]@($requestData.arguments)
  $directories = [string[]]@($requestData.directories)
  $code = [OksLockedJobLauncher]::Run(
    [string]$requestData.executable,
    $arguments,
    [string]$requestData.executableSha256,
    [string]$requestData.resource,
    [string]$requestData.resourceSha256,
    [string]$requestData.cwd,
    $directories
  )
  exit $code
} catch {
  [Console]::Error.WriteLine('[oks-windows-package-smoke:fatal]')
  exit 190
}
