/* Is this Node new enough for the register? Prints one line either way.
   Exits non-zero when it is not, so a batch file can stop. */
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`  Node.js ${process.versions.node} is too old -- this needs 22.5 or newer.`);
  console.error('  Install a current version from https://nodejs.org/ and try again.');
  process.exit(1);
}
console.log(`  Node.js ${process.versions.node}        ok`);
