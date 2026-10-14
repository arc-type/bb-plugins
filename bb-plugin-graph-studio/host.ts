import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract";
import { createHostJobs } from "./lib/host-jobs";

const retained = new Set<string>();

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    start: async (input, context) => {
      const jobs = createHostJobs(context.experimental_paths.dataDir);
      const result = await jobs.start(input);
      const key = `${context.experimental_paths.dataDir}/${input.jobId}`;
      if (retained.has(key) || jobs.poll({ jobId: input.jobId, since: 0 }).state !== "running") return result;
      retained.add(key);
      const lease = context.experimental_retainWorker();
      const release = () => {
        clearInterval(timer);
        retained.delete(key);
        context.lifecycle.signal.removeEventListener("abort", release);
        void lease.dispose();
      };
      const timer = setInterval(() => {
        if (jobs.poll({ jobId: input.jobId, since: 0 }).state !== "running") {
          release();
        }
      }, 1000);
      timer.unref();
      context.lifecycle.signal.addEventListener("abort", release, { once: true });
      return result;
    },
    poll: (input, context) => createHostJobs(context.experimental_paths.dataDir).poll(input),
    stop: (input, context) => createHostJobs(context.experimental_paths.dataDir).stop(input),
    ping: (_input, context) => createHostJobs(context.experimental_paths.dataDir).ping(),
  },
});
