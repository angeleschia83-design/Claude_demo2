/* Waits for the register to answer on a port, so an installer can prove the
   thing it set up is actually running rather than assuming it.
     node extras/wait-for-app.mjs <port> [seconds] */
const port = Number(process.argv[2] || 3000);
const seconds = Number(process.argv[3] || 25);

const until = Date.now() + seconds * 1000;
let lastError = 'no answer';
while (Date.now() < until) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) });
    if (res.ok && (await res.text()).trim() === 'ok') {
      console.log(`  The register is answering on port ${port}.`);
      process.exit(0);
    }
    lastError = `replied ${res.status}`;
  } catch (error) {
    lastError = error.name === 'TimeoutError' ? 'timed out' : (error.code || error.message);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.error(`  Nothing is answering on port ${port} after ${seconds} seconds (${lastError}).`);
process.exit(1);
