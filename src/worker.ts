import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities';
import { TASK_QUEUE } from './shared';
import { startApi } from './api';

async function run() {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';

  console.log(`[AgentCore Worker] Connecting to Temporal at ${address}`);
  console.log(`[AgentCore Worker] Task queue: ${TASK_QUEUE}`);

  const connection = await NativeConnection.connect({ address });

  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  // Start HTTP Trigger API alongside the worker
  await startApi(address);

  console.log('[AgentCore Worker] Running...');
  await worker.run();
}

run().catch((err) => {
  console.error('[AgentCore Worker] Fatal error:', err);
  process.exit(1);
});
