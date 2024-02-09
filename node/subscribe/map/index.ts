import { WaveRmqExchanges } from "wave_stores";
import { SubscriptionResolver } from "../../../types";

import { rmqAsyncIteratorFactory } from "../../../util/sub/rmqAsyncIteratorFactory";
import { getLogger } from "wave_stores";

const resolver = (mapLayers: MapLayerEntry[]) => ({
    mapLayers: [mapLayers].flat(),
});

const factory = ({
    logger = getLogger("wave:api"),
    subAsyncIterator = rmqAsyncIteratorFactory({ logger }),
} = {}): {
    mapLayers: SubscriptionResolver<
        MapLayerEntry,
        { filters: MapLayerFilters }
    >;
} => {
    const { info } = logger.getDebuggers("subs:map");

    return {
        mapLayers: async (...param) => {
            const [{ filters }, context] = param;
            const { traceId, ...rest } = context;
            // TODO withFilters
            info("mapLayers", { ...filters, ...rest });
            return subAsyncIterator<MapLayerEntry>({
                topic: "map.layers.*",
                exchange: WaveRmqExchanges.documents,
                resolver,
            });
        },
    };
};

export { factory, resolver };
