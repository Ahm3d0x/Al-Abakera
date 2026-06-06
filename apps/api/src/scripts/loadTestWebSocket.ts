import { io as Client } from 'socket.io-client';
import dotenv from 'dotenv';

dotenv.config();

const argv = process.argv.slice(2);
const getArg = (name: string, fallback: number): number => {
  const idx = argv.indexOf(name);
  if (idx !== -1 && argv[idx + 1]) {
    return parseInt(argv[idx + 1], 10);
  }
  return fallback;
};

const targetUsers = getArg('--target', 100);
const batchSize = getArg('--batch', 20);
const apiPort = process.env.PORT || '5000';
const socketUrl = process.env.SOCKET_URL || `http://localhost:${apiPort}`;

console.log(`=================================================`);
console.log(`🚀 MindRace WebSocket Load Tester`);
console.log(`🌐 Target Server URL: ${socketUrl}`);
console.log(`👥 Target Connections: ${targetUsers}`);
console.log(`📦 Batch Size: ${batchSize} per batch`);
console.log(`=================================================`);

const clients: any[] = [];
let successfulConnections = 0;
let failedConnections = 0;
let disconnectedCount = 0;
const connectionTimes: number[] = [];

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeStats() {
  const total = successfulConnections + failedConnections;
  const avgLatency = connectionTimes.length > 0
    ? connectionTimes.reduce((a, b) => a + b, 0) / connectionTimes.length
    : 0;
  const sortedTimes = [...connectionTimes].sort((a, b) => a - b);
  const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)] || 0;
  const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)] || 0;
  const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)] || 0;

  console.log(`\n📊 WebSocket Load Test Status:`);
  console.log(`-------------------------------------------------`);
  console.log(`📈 Attempts: ${clients.length} / ${targetUsers}`);
  console.log(`✅ Connected: ${successfulConnections}`);
  console.log(`❌ Failed: ${failedConnections}`);
  console.log(`📉 Disconnected: ${disconnectedCount}`);
  console.log(`⏱️  Avg Latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`⏱️  P50 Latency: ${p50}ms`);
  console.log(`⏱️  P95 Latency: ${p95}ms`);
  console.log(`⏱️  P99 Latency: ${p99}ms`);
  console.log(`-------------------------------------------------`);
}

async function startTest() {
  let batchCount = 0;
  for (let i = 0; i < targetUsers; i += batchSize) {
    const batchPromises = [];
    const limit = Math.min(targetUsers, i + batchSize);
    for (let index = i; index < limit; index++) {
      batchPromises.push(connectClient(index));
    }
    await Promise.all(batchPromises);
    batchCount++;
    console.log(`🔄 Batch ${batchCount} completed (${limit} connections)`);
    computeStats();
    await delay(100); // 100ms gap between batches to avoid socket connection spikes
  }

  console.log(`\n🎉 All connections spawned. Holding for 5 seconds to test stability...`);
  await delay(5000);
  computeStats();

  console.log(`\n🧹 Cleaning up connections...`);
  clients.forEach(c => {
    try {
      c.close();
    } catch (e) {}
  });
  console.log(`🏁 Test completed.`);
}

function connectClient(index: number): Promise<void> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = Client(socketUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: {
        isAudience: true,
        username: `loadtest-user-${index}`,
        fingerprint: `fingerprint-loadtest-${index}`
      }
    });

    clients.push(socket);

    socket.on('connect', () => {
      successfulConnections++;
      connectionTimes.push(Date.now() - startTime);
      resolve();
    });

    socket.on('connect_error', (err) => {
      failedConnections++;
      resolve();
    });

    socket.on('disconnect', () => {
      disconnectedCount++;
    });
  });
}

process.on('SIGINT', () => {
  console.log('\n⚠️ Interrupted! Cleaning up...');
  clients.forEach(c => {
    try {
      c.close();
    } catch (e) {}
  });
  process.exit(0);
});

startTest().catch((err) => {
  console.error('Test run failed with error:', err);
});
