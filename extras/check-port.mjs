/* Is this port already taken? If it is, the register cannot start on it, and
   a browser pointed there shows whatever IS running -- somebody else's copy,
   or an older one of yours, with its own data and its own password. That is a
   confusing way to lose an afternoon, so say it plainly before it happens. */
import net from 'node:net';

const port = Number(process.argv[2] || 3000);

const server = net.createServer();
server.once('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`  Port ${port} is already being used by something on this computer.`);
    console.error('');
    console.error('  That is usually another copy of the register still running -- look for');
    console.error('  another black window, and close it. If you open the browser anyway you');
    console.error('  will be looking at THAT copy, with its own people, assets and password,');
    console.error('  not this one.');
    console.error('');
    console.error(`  To use a different port instead, change PORT in device-register\\.env.`);
  } else {
    console.error(`  Could not check port ${port}: ${err.message}`);
  }
  process.exit(1);
});
server.once('listening', () => {
  server.close(() => {
    console.log(`  Port ${port}             free`);
    process.exit(0);
  });
});
server.listen(port, '127.0.0.1');
