import { useQuery } from "react-query";

import { getAuthedTransport, getRuntimeCfg } from "./util";

const getJobSdk = () =>
    getAuthedTransport().then((transport) => jobs(transport));

export const getJob = async (filters: JobFilters) => {
    return await (await getJobSdk()).getJobs(filters);
};

export const useGetJobs = (filters: JobFilters) => {
    return useQuery(
        ["jobs", filters],
        async (context) => {
            const { jobs } = await (await getJobSdk()).getJobs(filters);
            return jobs.filter((x) => x!!);
        },
        {
            enabled: !!filters.jobUUID?.length,
            refetchInterval: 1000,
        }
    );
};

type JobSubscriptionResponse = {
    data: {
        gqlDocumentMutation: DocumentMutationEvent[];
    };
};

export const subscribeJobs = async () => {
    const runtimeConfig = await getRuntimeCfg();
    const endpoint = `${
        runtimeConfig?.WAVE_WS_URL || window.location.hostname
    }:${runtimeConfig?.WS_PORT || 8080}/subs`;

    return jobsSubscription(
        getSocketClient({ endpoint })
    ).getGQLDocumentMutationSubscriptionIterator() as AsyncGenerator<JobSubscriptionResponse>;
};

export const getQueuedJobs = async (
    jobFilters: JobQueueRequest<ImportJobs>
) => {
    const result = await (await getJobSdk()).queueJob(jobFilters);

    return result;
};
