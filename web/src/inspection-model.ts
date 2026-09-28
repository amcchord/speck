/** Windows Win32_Service StartMode codes; Linux retains reported systemd state. */
export function serviceStartup(value: unknown, platform: string): string {
  if (value === null || value === undefined || value === "")
    return "Startup not reported";
  const names: Record<string, string> = {
    "0": "Boot driver",
    "1": "System driver",
    "2": "Automatic",
    "3": "Manual / on demand",
    "4": "Disabled",
  };
  return platform === "windows"
    ? names[String(value)] || String(value)
    : String(value);
}
