const cluster = require('cluster');
const os = require('os');
const path = require('path');

/**
 * Cluster Process Manager
 * Safely handles multi-core clustering in standalone environments
 * while gracefully disabling internal clustering when running under Phusion Passenger / cPanel.
 */

const isPassenger = !!(
  process.env.PASSENGER_APP_ENV ||
  process.env.PASSENGER_ENVIRONMENT ||
  process.env.LSWS_APP_PREFIX ||
  process.env.DISABLE_CLUSTER === 'true'
);

if (isPassenger) {
  console.log(`[Process PID ${process.pid}] Running under cPanel Phusion Passenger. Internal cluster disabled for socket stability.`);
  process.env.IS_PRIMARY_PROCESS = 'true';
  require('./app');
} else if (cluster.isPrimary || cluster.isMaster) {
  const numCPUs = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const workerCount = Math.max(1, Math.min(numCPUs, 16));

  console.log(`=======================================================`);
  console.log(`Primary Process [PID ${process.pid}] starting...`);
  console.log(`Detected ${numCPUs} CPU cores. Forking ${workerCount} worker processes.`);
  console.log(`=======================================================`);

  process.env.IS_PRIMARY_PROCESS = 'true';

  for (let i = 0; i < workerCount; i++) {
    cluster.fork({ IS_PRIMARY_PROCESS: 'false' });
  }

  cluster.on('exit', (worker, code, signal) => {
    console.warn(`Worker [PID ${worker.process.pid}] exited with code ${code} (${signal}). Restarting worker...`);
    cluster.fork({ IS_PRIMARY_PROCESS: 'false' });
  });

  const shutdownPrimary = () => {
    console.log('Primary process receiving shutdown signal. Stopping all workers...');
    for (const id in cluster.workers) {
      if (cluster.workers[id]) {
        cluster.workers[id].send('shutdown');
        cluster.workers[id].kill('SIGTERM');
      }
    }
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  };

  process.on('SIGINT', shutdownPrimary);
  process.on('SIGTERM', shutdownPrimary);
} else {
  process.env.IS_PRIMARY_PROCESS = 'false';
  require('./app');
}
