import app from './app.js';

const PORT = Number(process.env.PORT || 3001);

const BIND_HOST = process.env.LDVH_WEB_BIND_HOST || '127.0.0.1'
const server = app.listen(PORT, BIND_HOST, () => {
  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : PORT;
  console.log(`LDVH_WEB_PORT=${actualPort}`);
  console.log(`Server ready on port ${actualPort}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;