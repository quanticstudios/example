import { getLogger, WaveRmqExchanges } from "wave_stores";
import {
    SubscriptionResolver,
    GQLMutationNewDocumentResult,
} from "../../../types";
import { rmqAsyncIteratorFactory } from "../../../util/sub/rmqAsyncIteratorFactory";

const locationMutationResolver = (locMutation: LocationMuationEvent[]) => ({
    locationMutation: [locMutation].flat(),
});
const locationMetrics = (locMetric: MetricPayload["processedPayload"][]) => ({
    locationMetrics: [locMetric].flat(),
});
export interface LocationMuationEvent {
    name: string;
    meterId: string;
    nodeId: string;
    metrics: string[];
}

const factory = ({
    subAsyncIterator = rmqAsyncIteratorFactory(),
    logger = getLogger("wave:api"),
} = {}): {
    locationMutation: SubscriptionResolver<
        LocationMuationEvent,
        { filters: unknown }
    >;
    locationMetrics: SubscriptionResolver<
        MetricPayload["processedPayload"],
        { filters: unknown }
    >;
} => {
    const { info } = logger.getDebuggers("subs:locations");
    return {
        locationMetrics: async (...param) => {
            const [{ filters }, context] = param;
            const { traceId, ...rest } = context;
            info("locationMetrics", { filters, ...rest });
            return subAsyncIterator({
                // FIXME maybe make this meter.metrics.flowRate .temp .pressure etc. ?
                topic: "meter.metrics.#",
                exchange: WaveRmqExchanges.h2obridge,
                resolver: locationMetrics,
            });
        },
        locationMutation: async (...param) => {
            const [{ filters }, context] = param;
            const { traceId, ...rest } = context;
            info("locationMuationResult", { filters, ...rest });
            return subAsyncIterator({
                topic: "locations.mutation.#",
                exchange: WaveRmqExchanges.documents,
                resolver: locationMutationResolver,
            });
        },
    };
};

export { factory, locationMutationResolver as resolver };
