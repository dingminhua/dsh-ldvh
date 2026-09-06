/**
 * local server entry file, for local development
 */
import app from './app.js';

/**
 * start server with port
 */
const PORT = Number(process.env.PORT || 3001);

// 绑定地址：默认仅回环（挂载子进程场景——不暴露到局域网）；
// 独立开发如需外部访问可 LDVH_WEB_BIND_HOST=0.0.0.0。
const BIND_HOST = process.env.LDVH_WEB_BIND_HOST || '127.0.0.1'
const server = app.listen(PORT, BIND_HOST, () => {
  console.log(`Server ready on port ${PORT}`);
});

/**
 * close server
 */
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