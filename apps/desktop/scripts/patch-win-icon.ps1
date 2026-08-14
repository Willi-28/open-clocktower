param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,

  [Parameter(Mandatory = $true)]
  [string]$IconPath
)

$ErrorActionPreference = 'Stop'

$exe = (Resolve-Path -LiteralPath $ExePath).Path
$ico = (Resolve-Path -LiteralPath $IconPath).Path

if ([System.IO.Path]::GetExtension($exe) -ine '.exe') {
  throw "Icon patch target must be an .exe file: $exe"
}

$bytes = [System.IO.File]::ReadAllBytes($ico)
if ($bytes.Length -lt 6) {
  throw "Invalid ICO file: $ico"
}

$reserved = [BitConverter]::ToUInt16($bytes, 0)
$type = [BitConverter]::ToUInt16($bytes, 2)
$count = [BitConverter]::ToUInt16($bytes, 4)
if ($reserved -ne 0 -or $type -ne 1 -or $count -lt 1) {
  throw "Invalid ICO header: $ico"
}

$entries = @()
for ($i = 0; $i -lt $count; $i++) {
  $offset = 6 + ($i * 16)
  if ($offset + 16 -gt $bytes.Length) {
    throw "Invalid ICO directory entry in: $ico"
  }

  $imageSize = [BitConverter]::ToUInt32($bytes, $offset + 8)
  $imageOffset = [BitConverter]::ToUInt32($bytes, $offset + 12)
  if ($imageOffset + $imageSize -gt $bytes.Length) {
    throw "Invalid ICO image data in: $ico"
  }

  $image = New-Object byte[] ([int]$imageSize)
  [Array]::Copy($bytes, [int]$imageOffset, $image, 0, [int]$imageSize)
  $entries += [pscustomobject]@{
    Id = $i + 1
    Width = $bytes[$offset]
    Height = $bytes[$offset + 1]
    ColorCount = $bytes[$offset + 2]
    Planes = [BitConverter]::ToUInt16($bytes, $offset + 4)
    BitCount = [BitConverter]::ToUInt16($bytes, $offset + 6)
    Size = $imageSize
    Image = $image
  }
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WinIconResourceUpdate {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr BeginUpdateResource(string fileName, bool deleteExistingResources);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint dataSize);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool EndUpdateResource(IntPtr update, bool discard);
}
'@

$handle = [WinIconResourceUpdate]::BeginUpdateResource($exe, $false)
if ($handle -eq [IntPtr]::Zero) {
  throw "BeginUpdateResource failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}

try {
  foreach ($entry in $entries) {
    $ok = [WinIconResourceUpdate]::UpdateResource($handle, [IntPtr]3, [IntPtr]$entry.Id, 0, $entry.Image, [uint32]$entry.Image.Length)
    if (-not $ok) {
      throw "UpdateResource RT_ICON failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
  }

  $group = [System.Collections.Generic.List[byte]]::new()
  $group.AddRange([BitConverter]::GetBytes([uint16]0))
  $group.AddRange([BitConverter]::GetBytes([uint16]1))
  $group.AddRange([BitConverter]::GetBytes([uint16]$entries.Count))

  foreach ($entry in $entries) {
    $group.Add([byte]$entry.Width)
    $group.Add([byte]$entry.Height)
    $group.Add([byte]$entry.ColorCount)
    $group.Add([byte]0)
    $group.AddRange([BitConverter]::GetBytes([uint16]$entry.Planes))
    $group.AddRange([BitConverter]::GetBytes([uint16]$entry.BitCount))
    $group.AddRange([BitConverter]::GetBytes([uint32]$entry.Size))
    $group.AddRange([BitConverter]::GetBytes([uint16]$entry.Id))
  }

  $groupBytes = $group.ToArray()
  $ok = [WinIconResourceUpdate]::UpdateResource($handle, [IntPtr]14, [IntPtr]1, 0, $groupBytes, [uint32]$groupBytes.Length)
  if (-not $ok) {
    throw "UpdateResource RT_GROUP_ICON failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
} catch {
  [WinIconResourceUpdate]::EndUpdateResource($handle, $true) | Out-Null
  throw
}

$finished = [WinIconResourceUpdate]::EndUpdateResource($handle, $false)
if (-not $finished) {
  throw "EndUpdateResource failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
