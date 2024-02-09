import { WaveRmqExchanges } from "wave_stores";
import { SubscriptionResolver, ProcessorJobEvent } from "../../../types";
import { rmqAsyncIteratorFactory } from "../../../util/sub/rmqAsyncIteratorFactory";

import { getLogger } from "wave_stores";

const resolver = <T extends ETLJobTypes>(jobResult: ProcessorJobEvent<T>[]) => {
    return {
        jobsResult: [jobResult].flat(),
    };
};

const factory = ({
    subAsyncIterator = rmqAsyncIteratorFactory(),
    logger = getLogger("wave:api"),
} = {}): {
    jobsResult: SubscriptionResolver<
        ProcessorJobEvent<any>,
        { filters: unknown }
    >;
} => {
    const { info } = logger.getDebuggers("subs:jobs");

    return {
        jobsResult: async (...param) => {
            const [{ filters }, context] = param;
            const { traceId, ...rest } = context;
            info("jobsResults sub", { filters, ...rest });
            return subAsyncIterator<ProcessorJobEvent<any>>({
                topic: "jobs.scheduled.complete",
                exchange: WaveRmqExchanges.documents,
                resolver,
            });
        },
    };
};

export { factory, resolver };
