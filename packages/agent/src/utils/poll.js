// packages/agent/src/utils/poll.ts
export async function pollUntil(args) {
    const started = Date.now();
    while (true) {
        const res = await args.fn();
        if (args.isDone(res))
            return res;
        if (Date.now() - started > args.timeoutMs) {
            throw new Error("poll_timeout");
        }
        await new Promise((r) => setTimeout(r, args.intervalMs));
    }
}
