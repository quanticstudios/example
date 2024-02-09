import { WaveRmqExchanges } from "wave_stores";
import {
    SubscriptionResolver,
    GQLMutationNewDocumentResult,
} from "../../../types";
import { rmqAsyncIteratorFactory } from "../../../util/sub/rmqAsyncIteratorFactory";

import { getLogger } from "wave_stores";

const resolver = (docMutation: DocumentMutationEvent[]) => ({
    gqlDocumentMutation: [docMutation].flat(),
});
const factory = ({
    logger = getLogger("wave:api"),
    subAsyncIterator = rmqAsyncIteratorFactory({ logger }),
} = {}): {
    gqlDocumentMutation: SubscriptionResolver<
        DocumentMutationEvent,
        { filters: unknown }
    >;
} => {
    const { info } = logger.getDebuggers("subs:documents");

    return {
        gqlDocumentMutation: async (...param) => {
            const [{ filters }, context] = param;
            const { traceId, ...rest } = context;
            // TODO withFilters
            info("gqlDocumentMuationResult", { filters, ...rest });
            return subAsyncIterator<DocumentMutationEvent>({
                topic: "document.mutation.#",
                exchange: WaveRmqExchanges.documents,
                resolver,
            });
        },
    };
};

export { factory, resolver };
