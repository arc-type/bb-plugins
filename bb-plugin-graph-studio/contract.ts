import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

// Safe as a directory name; callers hash the execution identity into this id.
export const jobIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const startJobSchema = z.object({
  jobId: jobIdSchema,
  command: z.string().min(1),
  cwd: z.string().min(1),
  timeoutMs: z.number().int().positive(),
});
export const jobPollSchema = z.object({
  state: z.enum(["running", "exited", "unknown"]),
  exitCode: z.number().int().nullable(),
  stdoutTail: z.string(),
  stderrTail: z.string(),
  nextOffset: z.number().int().nonnegative(),
});
export const hostContract = defineRpcContract({
  start: { input: startJobSchema, output: z.object({ started: z.literal(true) }) },
  poll: {
    input: z.object({ jobId: jobIdSchema, since: z.number().int().nonnegative() }),
    output: jobPollSchema,
  },
  stop: {
    input: z.object({ jobId: jobIdSchema }),
    output: z.object({ stopped: z.boolean() }),
  },
  ping: {
    input: z.object({}),
    output: z.object({
      hostname: z.string(),
      bash: z.boolean(), jq: z.boolean(), git: z.boolean(), bun: z.boolean(), gh: z.boolean(),
    }),
  },
});
export type StartJob = z.infer<typeof startJobSchema>;
export type JobPoll = z.infer<typeof jobPollSchema>;
