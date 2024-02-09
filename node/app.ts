import express, { Response, Handler } from "express";
import { graphqlHTTP } from "express-graphql";
import {
    buildSchema,
    DocumentNode,
    execute,
    ExecutionArgs,
    GraphQLAbstractType,
    GraphQLSchema,
    parse,
    validate,
    ValidationRule,
} from "graphql";
import { readFileSync } from "fs";
import { resolvers as _resolvers } from "./resolvers";
import cors from "cors";
import path from "path";
import { resolvers as scalarResolvers } from "graphql-scalars";
import passport from "passport";
import {
    authStore,
    WaveLocalStrategyVerifyMiddleWareAuthneticatedUser,
} from "./util/auth/passport";
import LocalStrategy from "passport-local";

import { User, getLogger, cache } from "wave_stores";
import { ServerResponse, createServer } from "http";
import { ApiError } from "./util/ApiError";
import asyncMiddleware from "./util/io/asyncMiddlware";
import { gqlCacheMW } from "./util/io/cacheMiddleware";
import { GraphQLUpload, graphqlUploadExpress } from "graphql-upload";
import { StatusCodes } from "http-status-codes";
import { WebSocketServer, Server, WebSocket } from "ws";
// TODO subscriptions-transport-ws has been deprecated for graphql-ws but graphiql and playground are still in PR review for the new protocol. Will switch over when merged
import { CloseCode, GRAPHQL_TRANSPORT_WS_PROTOCOL } from "graphql-ws";
import { useServer } from "graphql-ws/lib/use/ws";
import { SubscriptionServer, GRAPHQL_WS } from "subscriptions-transport-ws";
import expressPlayground from "graphql-playground-middleware-express";
import {
    serverSubscriptionEventHandlers,
    WebSocketWithId,
} from "./util/sub/serverSubcriptionOptions";
import { v4 as uuid } from "uuid";
import { checkHasPermToOperateOnResource } from "./util/auth/acl";
import { OperationOnResource, Resources } from "./types";
import { metricsExpressRoute } from "./util/metrics";
import compression from "compression";

type GraphQLResponse = Response & {
    json?: (data: unknown) => void;
};
interface AuthedGraphHTTPResponse extends GraphQLResponse {
    locals: {
        user: WaveLocalStrategyVerifyMiddleWareAuthneticatedUser;
        waveRespIsCachable?: boolean;
        waveRespCacheKey: string;
        parsedQuery?: DocumentNode;
    };
}

const app = ({
    logger = getLogger("wave:api"),
    schemaString = readFileSync(
        path.resolve(__dirname, "../schema/schema.graphql")
    ).toString("utf-8"),
    dbSchema = process.env.WAVE_PG_SCHEMA || "default",
    resolvers = _resolvers({
        logger,
        schema: dbSchema,
    }),
    auth = authStore({ logger, schema: dbSchema }),
    port = 8080,
    cacheStore = cache(),
} = {}) => {
    const { info, error } = logger.getDebuggers("app");
    const schema = buildSchema(schemaString);
    const app = express();

    // TODO add helmet

    app.use(asyncMiddleware({ logger }));
    app.use(cors());
    app.use(compression({ threshold: "1mb", level: 8 }));
    app.use(graphqlUploadExpress({ maxFieldSize: 1000000, maxFiles: 10 }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(passport.initialize());

    passport.use(
        new LocalStrategy.Strategy(
            {
                usernameField: "user",
                passwordField: "pass",
                passReqToCallback: true,
            },
            auth.localStrategyVerifyMiddleWare
        )
    );

    passport.serializeUser<User>((user, done) => {
        (async () => {
            try {
                const userId = user as number;
                const loggedInUser = await auth.serializeUser(userId);
                done(null, loggedInUser);
            } catch (err) {
                done(err);
            }
        })();
    });

    passport.deserializeUser<number, express.Request>((req, id, done) => {
        (async () => {
            try {
                const { authorization: token } = req.headers;
                const userId = await auth.deserializeUser(token);
                done(null, userId);
            } catch (err) {
                done(err);
            }
        })();
    });
    // Login with email/pass Route
    // Authenticates then serializes the user, and returns the token
    app.post(
        "/auth/email",
        passport.authenticate("local", {
            session: false,
            failWithError: true,
        }),
        (req, res, next) => {
            const { user } = req;
            if (!user) {
                res.status(StatusCodes.UNAUTHORIZED);
                next();
                return;
            }
            const {
                user: { id: userId },
                token,
            } = user as WaveLocalStrategyVerifyMiddleWareAuthneticatedUser;

            res.json({ userId, token });
        }
    );

    // File download endpoint
    // TODO offload this to storage blobs with auth
    app.get(
        "/dl/:fileName",
        auth.checkAuthMiddleware,
        async (req, res, next) => {
            info("-> downloadFile", { filename: req.params.fileName });
            await checkHasPermToOperateOnResource(
                res.locals.user,
                OperationOnResource.readAny,
                Resources.downloads
            );
            if (!req.params?.fileName) {
                throw new ApiError(
                    "Missing file name to downloads",
                    StatusCodes.BAD_REQUEST
                );
            }
            const downloadDir = process.env.WAVE_FILE_UPLOAD_DIR;
            // TODO check permission to access specific file, RBAC based or entry per user
            const fileName = `${downloadDir}/${req.params.fileName}`;
            res.sendFile(fileName);
        }
    );

    // Playground
    app.get(
        "/",
        expressPlayground({ subscriptionEndpoint: "/subs", endpoint: "/" })
    );
    // Async error/handler
    app.use(
        (
            err: Error,
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
        ) => {
            error("middleware", { ...req.params }, { error: err });
            if (err instanceof ApiError) {
                res.status(err.getCode()).json({ msg: err.getMessage() });
            } else {
                res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                    msg: err.message,
                });
            }
        }
    );

    // Add metrics route
    app.use("/metrics", metricsExpressRoute());

    // Graph QL Api Route, protected by login
    const rootValue = {
        ...resolvers,
        ...scalarResolvers,
        GraphQLUpload,
    };

    const isJobProcessingResp = (resp: JobProcessingResp) =>
        resp?.jobId || resp?.jobBatchUUID;
    const typeResolver = (
        value: unknown,
        _context: unknown,
        _info: unknown,
        abstractType: GraphQLAbstractType
    ) => {
        switch (abstractType.name) {
            case "PopEvalTimeSeriesResponse":
                return isJobProcessingResp(value as JobProcessingResp)
                    ? "JobProcessingResponse"
                    : "PopEvalTimeSeries";
            case "PdpEvalTimeSeriesResponse":
                return isJobProcessingResp(value as JobProcessingResp)
                    ? "JobProcessingResponse"
                    : "PdpEvalTimeSeries";
            case "CollectionsEvalTimeSeriesResponse":
                return isJobProcessingResp(value as JobProcessingResp)
                    ? "JobProcessingResponse"
                    : "CollectionsEvalTimeSeries";
            case "CapacityCollectionTimeseriesResponse":
                return isJobProcessingResp(value as JobProcessingResp)
                    ? "JobProcessingResponse"
                    : "CapacityCollectionTimeSeries";
            case "ScenarioTimeSeriesResponse":
                return isJobProcessingResp(value as JobProcessingResp)
                    ? "JobProcessingResponse"
                    : "ScenarioTimeSeries";
            case "AnalyticsResultResponse":
                return isJobProcessingResp(value as JobProcessingResp)
                    ? "JobProcessingResponse"
                    : "AnalyticsPayload";
            case "Segment":
                return (value as Segment)?._segmentType ===
                    SegmentType.timeSeries
                    ? "DataSeriesSegment"
                    : "LineEqSegment";
            default:
                throw "Unhandled union or interface " + abstractType.name;
        }
    };
    const gqlCache = gqlCacheMW({ cacheStore, logger });
    app.post(
        "/",
        async (req, res, next) => {
            const traceId = uuid().slice(0, 8);
            logger.setTraceId(traceId);
            res.setHeader("X-WaveTraceId", traceId);
            next();
        },
        auth.checkAuthMiddleware,
        gqlCache.cacheLoader,
        graphqlHTTP(async (req, res, params) => {
            const authRes = res as AuthedGraphHTTPResponse;
            const {
                user = null,
                roles = null,
                access = null,
            } = authRes.locals?.user || {};
            return {
                graphiql: false,
                schema,
                rootValue,
                context: { user, roles, access, traceId: logger.getTraceId() },
                // TODO cache middleware could have already parsed the query so reuse that if it did
                // need to include other variables besides query
                // customParseFn: source => authRes.locals.parsedQuery ?? parse(source),
                typeResolver,
                extensions: async (queryInfo) => ({
                    ...((await gqlCache.cacheSetterExtension(
                        queryInfo,
                        res as Response
                    )) || {}),
                }),
            };
        })
    );

    // Subscription setup
    const suboptions = serverSubscriptionEventHandlers(
        { schema, rootValue },
        auth,
        logger
    );

    // graphql-ws
    const server = createServer(app);
    const graphqlWs = new WebSocketServer({ noServer: true, path: "/subs" });
    useServer(
        {
            schema: suboptions.schema,
            execute: suboptions.execute,
            subscribe: suboptions.subscribe,
            onClose: async (ctx) => {
                info("->onClose");
                if (ctx?.subscriptions) {
                    info("-- onClose: closing subs");
                    await Promise.all(
                        Object.entries(ctx.subscriptions).map(
                            async ([, sub]) => {
                                let subStream;
                                while (
                                    (subStream =
                                        sub && sub[Symbol.asyncIterator]()) !==
                                        undefined &&
                                    subStream?.return
                                ) {
                                    return await subStream.return();
                                }
                            }
                        )
                    );
                }
            },
            onComplete: async (ctx, message) => {
                // TODO unsub clean up once frontend starts using it
                info("->onComplete", { ...message, ...ctx });
            },
            onSubscribe: (ctx, message) => {
                const context = suboptions.authenticateAndSetContext(
                    ctx.connectionParams,
                    ctx.extra.socket
                );
                return {
                    schema,
                    operationName: message.payload.operationName,
                    document: parse(message.payload.query),
                    variableValues: message.payload.variables,
                    // TODO remove socketId when confirmed not used anymore
                    contextValue: {
                        ...context,
                        socketId: Object.keys(ctx.subscriptions)[0],
                    },
                    rootValue,
                };
            },
        },
        graphqlWs
    );

    // subscriptions-transport-ws for legacy support
    // TODO remove this when frontend tooling support graph-ws protocol
    const subTransWs = new WebSocketServer({ noServer: true, path: "/subs" });
    SubscriptionServer.create(
        {
            schema: suboptions.schema,
            execute,
            rootValue: suboptions.rootValue,
            subscribe: suboptions.subscribe,
            onConnect: async (socket: WebSocket) => {
                // assign id to socket
                const subId = uuid();
                (socket as unknown as WebSocketWithId)["id"] = subId;
                info(`-> new socket connection, assigned Id: `, { subId });
                return socket;
            },
            onOperationComplete: (socket: WebSocketWithId, _: unknown) =>
                suboptions.onOperationComplete(socket?.id),
            onDisconnect: async (socket: WebSocketWithId) =>
                suboptions.onDisconnect(socket?.id),
            onOperation: async (
                msg: any,
                param: any,
                socket: WebSocketWithId
            ) => {
                return {
                    ...(await suboptions.authenticateAndSetContext(
                        param,
                        socket
                    )),
                    socketId: socket?.id,
                };
            },
        },
        subTransWs
    );

    // Server init
    server.on("upgrade", (req, socket, head) => {
        // extract websocket subprotocol from header
        const protocol = req.headers["sec-websocket-protocol"];
        const protocols = Array.isArray(protocol)
            ? protocol
            : protocol?.split(",").map((p) => p.trim());

        // Decide which websocket server to use
        // graphql-ws will welcome its own subprotocol and gracefully reject invalid ones. if the client supports
        // both transports, graphql-ws will prevail
        const wss =
            protocols?.includes(GRAPHQL_WS) &&
            !protocols.includes(GRAPHQL_TRANSPORT_WS_PROTOCOL)
                ? subTransWs
                : graphqlWs;
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
        });
    });
    const ws = server.listen(port, () => {
        info(
            `🌊 GraphQL HTTP & Subscriptions Server started on port ${port} !`
        );
    });

    return {
        app,
        server,
        // Promisified helper to close api server
        close: () =>
            new Promise((res, rej) =>
                ws.close((err) => (err ? rej(err) : res(0)))
            ),
    };
};

export { app };
