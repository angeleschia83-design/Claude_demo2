/* Node calls its own SQLite experimental and prints a warning on every start.
   Someone who double-clicked a launcher cannot act on that and may well read
   it as the thing being broken, so drop that one line and leave every other
   warning alone.

   Node prints warnings from its own default 'warning' listener rather than
   through process.emitWarning, so the filter has to replace that listener.

   This lives in its own module because `import` statements are hoisted: the
   filter must be installed by a module that loads BEFORE node:sqlite, which
   an assignment at the top of db.mjs would not do. */
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  const sqliteNotice =
    warning.name === 'ExperimentalWarning' && /SQLite is an experimental feature/.test(warning.message);
  if (sqliteNotice) return;
  console.error(warning.stack || `${warning.name}: ${warning.message}`);
});
