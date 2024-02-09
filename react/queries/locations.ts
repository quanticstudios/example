import { formatISO } from "date-fns";
import format from "date-fns/format";
import debounce from "lodash/debounce";
import _merge from "lodash/merge";
import _omit from "lodash/omit";
import _uniq from "lodash/uniq";
import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";

import LocationMetricsSubscriptionClient from "@src/clients/locationMetricsSubscription";
import LocationSubscriptionClient from "@src/clients/locationSubscription";
import useCategoryFiltersController, {
    FiltersList,
} from "@src/hooks/useCategoryFiltersController";
import {
    getLocations,
    getLocationsDataSeriesDateRange,
    getLocationSensorDataSeries,
    getLocationsMetaTags,
    getLocationsWithMetaTags,
    insertGeoLocation,
    updateGeoLocation,
    updateLocation,
    uploadLocationsCsv,
    UploadLocationsCsvParam,
    upsertLocationsStatus,
    upsertLocationsStatuses,
} from "@src/io/locations";
import {
    FluidLocationDataPoints,
    LocationMetrics,
    LocationsWithMetaTag,
} from "@src/types";
import waitForJob from "@src/utils/collections/waitForJob";

import { extraLocationTypes } from "./config";

type Points = { value: number; date: string }[];

type LocationsMetricsQuery = Record<string, Points>;

type ConnectionFilterParams = {
    distance: number;
    value: string;
};

const createConnectionsFilter = ({
    distance,
    value,
}: ConnectionFilterParams) => [
    {
        endLocationId: Number(value),
        maxDistance: distance,
        type: ConnectionTypes.WaterOutFlow,
    },
    {
        endLocationId: Number(value),
        maxDistance: distance,
        type: ConnectionTypes.OilOutFlow,
    },
    {
        endLocationId: Number(value),
        maxDistance: distance,
        type: ConnectionTypes.GasOutFlow,
    },
];

export const createLocationMetaFilters = (
    filtersList: FiltersList,
    additionalFilters: LocationFilters = {}
) => {
    const baseLocationsMeta: GQLLocationsMetaEntryFilter[] = [];
    const baseConnections: {
        endLocationId: number;
        maxDistance: number;
        type: ConnectionTypes;
    }[] = [];

    filtersList.forEach(({ metaName, value }) => {
        if (metaName === "ReceiptPoint") {
            baseConnections.push(
                ...createConnectionsFilter({ distance: 1, value })
            );
            return;
        }

        if (metaName === "FacilityName") {
            baseConnections.push(
                ...createConnectionsFilter({ distance: 2, value })
            );
            return;
        }

        if ((extraLocationTypes as string[]).includes(metaName)) {
            baseConnections.push(
                ...createConnectionsFilter({ distance: 5, value })
            );
            return;
        }

        baseLocationsMeta.push({
            metaName,
            value: metaName !== "Tags" ? value : ["%%", value],
        });
    });

    const {
        locationsMeta: additionalLocationsMeta,
        connections: additionalConnections,
        ...restAdditionalFilters
    } = additionalFilters;

    const locationsMeta = additionalLocationsMeta?.length
        ? baseLocationsMeta.concat(additionalLocationsMeta)
        : baseLocationsMeta;
    const connections = additionalConnections?.length
        ? baseConnections.concat(additionalConnections)
        : baseConnections;

    return {
        ...(locationsMeta.length > 0 && { locationsMeta }),
        ...(connections.length > 0 && { connections }),
        ...restAdditionalFilters,
    };
};

const useLocationsFilters = (
    filters: LocationFilters = {},
    ignoreCategoryFilter = false
) => {
    const { filtersList } = useCategoryFiltersController();

    return useMemo(() => {
        if (ignoreCategoryFilter) return filters;

        return createLocationMetaFilters(filtersList, filters);
    }, [filters, ignoreCategoryFilter, filtersList]);
};

const defaultUseLocationsFilters = {};
const defaultLocations: LocationsWithMetaTag[] = [];
let backupLocations: LocationsWithMetaTag[] = [];
let areLocationsBackedUp = false;

/**
 * Get locations with metaTags and other details
 * Generic type T used to identify tag meta types
 * @param filters
 * @param ignoreCategoryFilter
 */
export const useLocations = <T = unknown>(
    filters: LocationFilters = defaultUseLocationsFilters,
    ignoreCategoryFilter = false
) => {
    const combinedFilters = useLocationsFilters(filters, ignoreCategoryFilter);

    const queryClient = useQueryClient();
    const { locationsMeta, ...filtersWithoutLocationsMeta } = combinedFilters;
    const locationTypesInLocationsMeta = locationsMeta?.filter(
        ({ metaName }) => metaName !== "LocationType"
    );

    const combinedFiltersWithoutLocationType = {
        ...filtersWithoutLocationsMeta,
        ...(locationTypesInLocationsMeta?.length && {
            locationsMeta: locationTypesInLocationsMeta,
        }),
    };

    const queryResult = useQuery(
        ["locations", JSON.stringify(combinedFilters)],
        async () => {
            const locations = await getLocations<T>({
                limit: 50000,
                ...combinedFiltersWithoutLocationType,
            });

            const locationType = combinedFilters.locationsMeta
                ?.filter(({ metaName }) => metaName === "LocationType")
                .map((item) => item.value);

            const filteredLocations =
                locationType && locationType.length > 0
                    ? locations.filter(({ type }) =>
                          locationType?.some((item) => type === item)
                      )
                    : locations;

            return await getLocationsMetaTags<T>(filteredLocations);
        },
        {
            staleTime: 600000,
        }
    );

    const updateLocationsCache = useUpdateLocationsCache();

    useEffect(() => {
        LocationSubscriptionClient.subscribe((locationIds) => {
            updateLocationsCache(locationIds);
            queryClient.invalidateQueries("locationsMetaKeys");
        }, "handleLocationUpdate");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const locationsById = useMemo(
        () =>
            queryResult.data?.reduce<Record<string, LocationsWithMetaTag>>(
                (locationIdMap, location) => {
                    locationIdMap[location.id] = location;

                    return locationIdMap;
                },
                {}
            ) ?? {},
        [queryResult.data]
    );

    return {
        ...queryResult,
        locations: queryResult.data ?? defaultLocations,
        locationsById,
    };
};

export const useLocationsMetrics = (locationId: number) => {
    const queryClient = useQueryClient();
    const updateLocationsMetricsCache = useUpdateLocationsMetricsCache();
    useEffect(() => {
        LocationMetricsSubscriptionClient.subscribe((data) => {
            updateLocationsMetricsCache(data, locationId);
        }, "handleLocationMetricsUpdate");

        return () => {
            queryClient.setQueryData(["locationMetrics"], []);
        };
    }, [locationId]);

    return useQuery<LocationsMetricsQuery>(
        ["locationMetrics"],
        () => {
            return queryClient.getQueryData(["locationMetrics"]) ?? {};
        },
        {}
    ).data;
};

export const useGetLocationSensorDataSeries = (
    locationId: number,
    fromDate: Date,
    toDate: Date
) => {
    return useQuery(["locationSensorDataSeries", locationId], async () => {
        const data = await getLocationSensorDataSeries(
            locationId,
            fromDate,
            toDate
        );

        const metricsMap = new Map<string, number[]>();

        data[0]?.processedMetrics.forEach((item) => {
            const newDate = new Date(item.recievedAt).setMinutes(0, 0, 0);
            const hour = format(new Date(newDate), "yyyy-MM-dd'T'HH:mm:ss");
            if (metricsMap.has(hour)) {
                metricsMap.get(hour)?.push(item.value);
            } else {
                metricsMap.set(hour, [item.value]);
            }
        });

        return Array.from(metricsMap.entries()).map(([key, value]) => ({
            value: value.reduce((acc, curr) => acc + curr, 0) / value.length,
            date: key,
        }));
    });
};

/**
 * Use returned function to invalidate locations query.
 * No arguments will invalidate query called with no additional location filters.
 * @param filters Invalidate query with specific filters
 * @param ignoreCategoryFilter
 */
export const useInvalidateLocations = (
    filters: LocationFilters = defaultUseLocationsFilters,
    ignoreCategoryFilter = false
) => {
    const combinedFilters = useLocationsFilters(filters, ignoreCategoryFilter);
    const queryClient = useQueryClient();

    return useCallback(async () => {
        await queryClient.invalidateQueries([
            "locations",
            JSON.stringify(combinedFilters),
        ]);
    }, [combinedFilters, queryClient]);
};

export const useDiscardLocationChanges = (
    filters: LocationFilters = defaultUseLocationsFilters
) => {
    const queryClient = useQueryClient();
    const combinedFilters = useLocationsFilters(filters);

    return useMutation(async () => {}, {
        onMutate: async () => {
            if (areLocationsBackedUp) {
                queryClient.setQueryData(
                    ["locations", JSON.stringify(combinedFilters)],
                    backupLocations
                );
                areLocationsBackedUp = false;
                backupLocations = [];
            }
        },
    });
};

/**
 * Add locations mutation
 */
export const useAddLocations = () => {
    const invalidateLocations = useInvalidateLocations();

    return useMutation<void, Error, Parameters<typeof insertGeoLocation>[0][]>(
        async (locationsParams) => {
            await Promise.all(
                locationsParams.map((params) => insertGeoLocation(params))
            );
        },
        {
            onSuccess: () => {
                invalidateLocations();
            },
        }
    );
};

export const useUpdateLocationData = (
    filters: LocationFilters = defaultUseLocationsFilters,
    ignoreCategoryFilter = false
) => {
    const queryClient = useQueryClient();
    const combinedFilters = useLocationsFilters(filters);

    return (newLocations: LocationsWithMetaTag[]) => {
        const previousLocations = queryClient.getQueryData<
            LocationsWithMetaTag[]
        >(["locations", JSON.stringify(combinedFilters)]);
        if (!previousLocations) return;
        const mergedLocations = [...previousLocations, ...newLocations];
        queryClient.setQueriesData(
            ["locations", JSON.stringify(combinedFilters)],
            mergedLocations
        );
    };
};

export const useUpdateMeterLocationData = (filters: LocationFilters = {}) => {
    const queryClient = useQueryClient();
    const combinedFilters = useLocationsFilters(filters);

    return (meterLocation: LocationsWithMetaTag) => {
        const previousLocations = queryClient.getQueryData<
            LocationsWithMetaTag[]
        >(["locations", JSON.stringify(combinedFilters)]);
        if (!previousLocations) return;
        const mergedLocations = [
            ...previousLocations.filter((loc) => loc.id !== meterLocation.id),
            meterLocation,
        ];
        queryClient.setQueriesData(
            ["locations", JSON.stringify(combinedFilters)],
            mergedLocations
        );
    };
};

export const useUpdateLocations = (filters: LocationFilters = {}) => {
    const queryClient = useQueryClient();
    const combinedFilters = useLocationsFilters(filters);
    return useMutation<
        void,
        Error,
        {
            updatedLocations?: LocationsWithMetaTag[];
            locationParams: Parameters<typeof updateGeoLocation>[0];
        },
        any
    >(
        async (updateArgs) => {
            const { locationParams } = updateArgs;
            await updateGeoLocation(locationParams);
        },
        {
            onMutate: async (updateArgs) => {
                await queryClient.cancelQueries([
                    "locations",
                    JSON.stringify(combinedFilters),
                ]);
                const { locationParams, updatedLocations } = updateArgs;

                const previousLocations = queryClient.getQueryData<
                    LocationsWithMetaTag[]
                >(["locations", JSON.stringify(combinedFilters)]);
                if (!previousLocations) return;
                // is this even running in the new location update system? consider removal and just use onSuccess logic below
                if (updatedLocations) {
                    const mergedLocations = previousLocations.map(
                        (location) => {
                            const updatedLocation = updatedLocations.find(
                                (updatedLocation) =>
                                    updatedLocation.id === location.id
                            );
                            return updatedLocation ?? location;
                        }
                    );

                    // if location capacities are updated, invalidate the cache to force refetch latest
                    if (locationParams.insertLocationCapacity.length > 0) {
                        queryClient.invalidateQueries(["locationCapacities"]);
                    }

                    queryClient.setQueriesData(
                        ["locations", JSON.stringify(combinedFilters)],
                        mergedLocations
                    );
                }
                return { previousLocations };
            },
            onError: (err, variables, context) => {
                if (context?.previousLocations) {
                    queryClient.setQueriesData(
                        ["locations", JSON.stringify(combinedFilters)],
                        context.previousLocations
                    );
                }
                throw err;
            },
            onSuccess: async (data, updateArgs) => {
                const { locationParams } = updateArgs;

                const allLocationsQueries = queryClient.getQueriesData<
                    LocationsWithMetaTag[]
                >(["locations"]);

                const locationsToRefresh = _uniq([
                    ...locationParams.upsertLocationMeta.map(
                        ({ locationId }) => locationId
                    ),
                    ...locationParams.updateLocation.map(
                        ({ locationsId }) => locationsId
                    ),
                ]);

                if (locationsToRefresh.length > 0) {
                    const updatedLocations = await getLocationsWithMetaTags(
                        locationsToRefresh
                    );

                    // if location capacities are updated, invalidate the cache to force refetch latest
                    if (locationParams.insertLocationCapacity.length > 0) {
                        queryClient.invalidateQueries(["locationCapacities"]);
                    }

                    allLocationsQueries.forEach(([key, previousLocations]) => {
                        if (!previousLocations) return;

                        const mergedLocations = previousLocations.map(
                            (location) => {
                                const updatedLocation = updatedLocations.find(
                                    (updatedLocation) =>
                                        updatedLocation.id === location.id
                                );
                                return updatedLocation ?? location;
                            }
                        );

                        queryClient.setQueriesData(key, mergedLocations);
                    });
                }
            },
        }
    );
};

export const useUpdateLocationsLocally = (
    filters: LocationFilters = defaultUseLocationsFilters,
    ignoreCategoryFilter = false
) => {
    const queryClient = useQueryClient();
    const combinedFilters = useLocationsFilters(filters, ignoreCategoryFilter);

    return useMutation<
        void,
        Error,
        {
            updatedLocations: LocationsWithMetaTag[];
            locationParams: Parameters<typeof updateGeoLocation>[0];
        },
        any
    >(async () => {}, {
        onMutate: async (updateArgs) => {
            const { locationParams, updatedLocations } = updateArgs;

            const previousLocations = queryClient.getQueryData<
                LocationsWithMetaTag[]
            >(["locations", JSON.stringify(combinedFilters)]);
            if (!areLocationsBackedUp) {
                backupLocations = previousLocations ?? [];
                areLocationsBackedUp = true;
            }
            if (!previousLocations) return;

            const mergedLocations = previousLocations.map((location) => {
                const updatedLocation = updatedLocations.find(
                    (updatedLocation) => updatedLocation.id === location.id
                );
                return updatedLocation ?? location;
            });
            // if location capacities are updated, invalidate the cache to force re-fetch latest
            if (locationParams.insertLocationCapacity.length > 0) {
                queryClient.invalidateQueries(["locationCapacities"]);
            }
            queryClient.setQueriesData(
                ["locations", JSON.stringify(combinedFilters)],
                mergedLocations
            );
            return { previousLocations };
        },
    });
};

/**
 * Update location mutation
 */
export const useUpdateLocation = async (
    updateLocationsParams: Record<number, Parameters<typeof updateLocation>[0]>
) => {
    const { locationsById } = useLocations();

    return useCallback(
        () =>
            Promise.all(
                Object.keys(updateLocationsParams).map((locationId) =>
                    updateLocation(
                        _merge(
                            _omit(
                                locationsById[Number(locationId)],
                                "metaTags"
                            ),
                            updateLocationsParams[Number(locationId)]
                        )
                    )
                )
            ),
        [locationsById, updateLocationsParams]
    );
};

/**
 * Remove location mutation
 */
export const useRemoveLocation = () => {
    const invalidateLocations = useInvalidateLocations();
    const queryClient = useQueryClient();
    const combinedFilters = useLocationsFilters();

    return useMutation<void, Error, number>(
        async (locationId) => await upsertLocationsStatus(locationId),
        {
            onMutate: (removedLocationId) => {
                const previousLocations = queryClient.getQueryData([
                    "locations",
                    JSON.stringify(combinedFilters),
                ]);

                queryClient.setQueryData<LocationsWithMetaTag[]>(
                    ["locations", JSON.stringify(combinedFilters)],
                    (prev) =>
                        prev?.filter(
                            (location) =>
                                Number(location.id) !== removedLocationId
                        ) ?? []
                );

                return { previousLocations };
            },
            onSuccess: () => {
                invalidateLocations();
            },
        }
    );
};

export const useRemoveLocations = () => {
    return useMutation<void, Error, LocationsWithMetaTag[]>(
        async (locationIds) => {
            await upsertLocationsStatuses(locationIds);
        }
    );
};

export const getVarianceActuals = async (
    locationIds: number[],
    fromDate?: Date
) => {
    const locationDataSeries = await getLocationsDataSeriesDateRange({
        locationIds,
        fromDate: formatISO(fromDate ? fromDate : new Date(0)),
        grouping: "locationsId",
        toDate: formatISO(Date.now()),
    });

    if (!locationDataSeries) return {};

    return locationDataSeries.reduce<FluidLocationDataPoints>(
        (actuals, data) => {
            if (data.locationId && data.locationDataTypeId) {
                if (!(data.locationDataTypeId in actuals))
                    actuals[data.locationDataTypeId] = {};

                actuals[data.locationDataTypeId]![data.locationId] =
                    data.dataSeries.map(({ date, value }) => ({
                        date,
                        value: parseFloat(value),
                    }));
            }

            return actuals;
        },
        {}
    );
};

export const useUpdateLocationsCache = () => {
    const queryClient = useQueryClient();
    const locationIdsSet = new Set<number>();

    const debouncedFunction = debounce(async () => {
        const allLocationsCaches = queryClient.getQueriesData<
            LocationsWithMetaTag[]
        >(["locations"]);

        const newLocations = await getLocationsWithMetaTags(
            Array.from(locationIdsSet)
        );

        allLocationsCaches.forEach(([queryKey, queryData]) => {
            const cachedLocations = queryData ?? [];

            let updatedCachedLocations = [...cachedLocations];

            newLocations.forEach((newLocation) => {
                if (!newLocation) return;

                const newLocationId = newLocation.id;

                let newLocationFound = false;
                updatedCachedLocations = updatedCachedLocations.map(
                    (location, index) => {
                        if (location.id === newLocationId) {
                            newLocationFound = true;
                            return newLocation;
                        }

                        return location;
                    }
                );

                if (!newLocationFound) updatedCachedLocations.push(newLocation);
            });

            queryClient.setQueriesData(queryKey, updatedCachedLocations);
        });
        locationIdsSet.clear();
    }, 300);

    return async (locationIds: number[]) => {
        locationIds.forEach((locationId) => locationIdsSet.add(locationId));
        debouncedFunction();
    };
};

export const useUpdateLocationsMetricsCache = () => {
    const queryClient = useQueryClient();
    let updatedMetrics: LocationsMetricsQuery = {};

    const debouncedFunction = debounce(() => {
        const previousMetrics = queryClient.getQueryData<LocationsMetricsQuery>(
            ["locationMetrics"]
        );
        if (!previousMetrics) {
            queryClient.setQueryData(["locationMetrics"], updatedMetrics);
            return;
        }
        updatedMetrics = Object.keys(updatedMetrics).reduce(
            (acc, locationId) => {
                if (acc[locationId]) {
                    acc[locationId].push(...updatedMetrics[locationId]);
                } else {
                    acc[locationId] = updatedMetrics[locationId];
                }
                return acc;
            },
            previousMetrics
        );
        queryClient.setQueryData(["locationMetrics"], updatedMetrics);
    }, 1000);

    return async (data: LocationMetrics[], locationId: number) => {
        if (!data.find((metric) => metric.locationId === locationId)) return;

        updatedMetrics = data.reduce((acc, newMetric) => {
            if (newMetric.locationId !== locationId) return acc;

            if (acc[newMetric.locationId]) {
                acc[newMetric.locationId].push({
                    value: newMetric.value,
                    date: format(
                        new Date(newMetric.recievedAt),
                        "yyyy-MM-dd'T'HH:mm:ss"
                    ),
                });
            } else {
                acc[newMetric.locationId] = [
                    {
                        value: newMetric.value,
                        date: format(
                            new Date(newMetric.recievedAt),
                            "yyyy-MM-dd'T'HH:mm:ss"
                        ),
                    },
                ];
            }
            return acc;
        }, {} as LocationsMetricsQuery);

        debouncedFunction();
    };
};

export const useUploadLocationsCsv = () => {
    const invalidateLocations = useInvalidateLocations();
    return useMutation(
        async ({
            file,
            dataMap,
            insertMode,
        }: {
            file: File;
            dataMap: UploadLocationsCsvParam["dataMap"];
            insertMode: NonNullable<
                UploadLocationsCsvParam["importOptions"]
            >["insertMode"];
        }) => {
            return uploadLocationsCsv({
                dataMap,
                filename: file.name,
                file: file.slice(0, file.size),
                importOptions: {
                    insertMode,
                },
            });
        },
        {
            onSuccess: (response) => {
                waitForJob(response).then(() => {
                    invalidateLocations();
                });
            },
        }
    );
};
