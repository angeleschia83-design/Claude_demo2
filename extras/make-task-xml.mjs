/* Writes the Task Scheduler definition that keeps the register running when
   nobody is logged on.
     node extras/make-task-xml.mjs <path-to-app> <path-to-node.exe> <out.xml>

   XML rather than the simpler `schtasks /TR` form, because only the XML can
   set a working directory -- and the app writes register.db relative to it,
   so without one the register is created in C:\Windows\System32 and the real
   data sits untouched somewhere else. */
import fs from 'node:fs';
import path from 'node:path';

const [, , appDirArg, nodeExeArg, outArg] = process.argv;
if (!appDirArg || !nodeExeArg || !outArg) {
  console.error('usage: node extras/make-task-xml.mjs <app-dir> <node.exe> <out.xml>');
  process.exit(2);
}
const appDir = path.resolve(appDirArg);
const nodeExe = path.resolve(nodeExeArg);

for (const [what, where] of [['app folder', appDir], ['Node.js', nodeExe]]) {
  if (!fs.existsSync(where)) {
    console.error(`  Cannot find the ${what}: ${where}`);
    process.exit(1);
  }
}
if (!fs.existsSync(path.join(appDir, 'src', 'server.mjs'))) {
  console.error(`  ${appDir} does not look like the app folder -- no src\\server.mjs in it.`);
  process.exit(1);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* PT0S on ExecutionTimeLimit means no limit. The default is three days, which
   would stop the register mid-week for no visible reason. */
const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Device register. Runs whether anybody is logged on or not, and starts with Windows.</Description>
    <URI>\\DeviceRegister</URI>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <DisallowStartOnRemoteAppSession>false</DisallowStartOnRemoteAppSession>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${esc(nodeExe)}</Command>
      <Arguments>src\\server.mjs</Arguments>
      <WorkingDirectory>${esc(appDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;

/* schtasks wants UTF-16 with a byte-order mark. */
fs.writeFileSync(path.resolve(outArg), `\uFEFF${xml}`, 'utf16le');
console.log(`  Task definition written`);
console.log(`    runs:        ${nodeExe} src\\server.mjs`);
console.log(`    working in:  ${appDir}`);
console.log(`    as:          SYSTEM, at startup, no time limit`);
