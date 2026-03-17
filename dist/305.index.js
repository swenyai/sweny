export const id = 305;
export const ids = [305];
export const modules = {

/***/ 15305:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  TF: () => (/* binding */ CallToolResultSchema),
  gd: () => (/* binding */ CancelTaskRequestSchema),
  gH: () => (/* binding */ CancelTaskResultSchema),
  Sq: () => (/* binding */ CancelledNotificationSchema),
  GU: () => (/* binding */ CompleteResultSchema),
  u9: () => (/* binding */ CreateMessageRequestSchema),
  K1: () => (/* binding */ CreateMessageResultSchema),
  TI: () => (/* binding */ CreateMessageResultWithToolsSchema),
  Mg: () => (/* binding */ CreateTaskResultSchema),
  $9: () => (/* binding */ ElicitRequestSchema),
  n_: () => (/* binding */ ElicitResultSchema),
  wR: () => (/* binding */ EmptyResultSchema),
  O4: () => (/* binding */ ErrorCode),
  HM: () => (/* binding */ GetPromptResultSchema),
  oQ: () => (/* binding */ GetTaskPayloadRequestSchema),
  Ql: () => (/* binding */ GetTaskRequestSchema),
  Sc: () => (/* binding */ GetTaskResultSchema),
  Rk: () => (/* binding */ InitializeResultSchema),
  OR: () => (/* binding */ JSONRPCMessageSchema),
  aE: () => (/* binding */ LATEST_PROTOCOL_VERSION),
  xI: () => (/* binding */ ListChangedOptionsBaseSchema),
  Yu: () => (/* binding */ ListPromptsResultSchema),
  O$: () => (/* binding */ ListResourceTemplatesResultSchema),
  cv: () => (/* binding */ ListResourcesResultSchema),
  zR: () => (/* binding */ ListTasksRequestSchema),
  a5: () => (/* binding */ ListTasksResultSchema),
  WT: () => (/* binding */ ListToolsResultSchema),
  Nh: () => (/* binding */ McpError),
  tC: () => (/* binding */ PingRequestSchema),
  _r: () => (/* binding */ ProgressNotificationSchema),
  br: () => (/* binding */ PromptListChangedNotificationSchema),
  EV: () => (/* binding */ RELATED_TASK_META_KEY),
  ve: () => (/* binding */ ReadResourceResultSchema),
  hh: () => (/* binding */ ResourceListChangedNotificationSchema),
  Iu: () => (/* binding */ SUPPORTED_PROTOCOL_VERSIONS),
  ki: () => (/* binding */ TaskStatusNotificationSchema),
  fH: () => (/* binding */ ToolListChangedNotificationSchema),
  LW: () => (/* binding */ isJSONRPCErrorResponse),
  lg: () => (/* binding */ isJSONRPCNotification),
  vo: () => (/* binding */ isJSONRPCRequest),
  ig: () => (/* binding */ isJSONRPCResultResponse),
  bZ: () => (/* binding */ isTaskAugmentedRequestParams)
});

// UNUSED EXPORTS: AnnotationsSchema, AudioContentSchema, BaseMetadataSchema, BlobResourceContentsSchema, BooleanSchemaSchema, CallToolRequestParamsSchema, CallToolRequestSchema, CancelledNotificationParamsSchema, ClientCapabilitiesSchema, ClientNotificationSchema, ClientRequestSchema, ClientResultSchema, ClientTasksCapabilitySchema, CompatibilityCallToolResultSchema, CompleteRequestParamsSchema, CompleteRequestSchema, ContentBlockSchema, CreateMessageRequestParamsSchema, CursorSchema, DEFAULT_NEGOTIATED_PROTOCOL_VERSION, ElicitRequestFormParamsSchema, ElicitRequestParamsSchema, ElicitRequestURLParamsSchema, ElicitationCompleteNotificationParamsSchema, ElicitationCompleteNotificationSchema, EmbeddedResourceSchema, EnumSchemaSchema, GetPromptRequestParamsSchema, GetPromptRequestSchema, GetTaskPayloadResultSchema, IconSchema, IconsSchema, ImageContentSchema, ImplementationSchema, InitializeRequestParamsSchema, InitializeRequestSchema, InitializedNotificationSchema, JSONRPCErrorResponseSchema, JSONRPCErrorSchema, JSONRPCNotificationSchema, JSONRPCRequestSchema, JSONRPCResponseSchema, JSONRPCResultResponseSchema, JSONRPC_VERSION, LegacyTitledEnumSchemaSchema, ListPromptsRequestSchema, ListResourceTemplatesRequestSchema, ListResourcesRequestSchema, ListRootsRequestSchema, ListRootsResultSchema, ListToolsRequestSchema, LoggingLevelSchema, LoggingMessageNotificationParamsSchema, LoggingMessageNotificationSchema, ModelHintSchema, ModelPreferencesSchema, MultiSelectEnumSchemaSchema, NotificationSchema, NumberSchemaSchema, PaginatedRequestParamsSchema, PaginatedRequestSchema, PaginatedResultSchema, PrimitiveSchemaDefinitionSchema, ProgressNotificationParamsSchema, ProgressSchema, ProgressTokenSchema, PromptArgumentSchema, PromptMessageSchema, PromptReferenceSchema, PromptSchema, ReadResourceRequestParamsSchema, ReadResourceRequestSchema, RelatedTaskMetadataSchema, RequestIdSchema, RequestSchema, ResourceContentsSchema, ResourceLinkSchema, ResourceReferenceSchema, ResourceRequestParamsSchema, ResourceSchema, ResourceTemplateReferenceSchema, ResourceTemplateSchema, ResourceUpdatedNotificationParamsSchema, ResourceUpdatedNotificationSchema, ResultSchema, RoleSchema, RootSchema, RootsListChangedNotificationSchema, SamplingContentSchema, SamplingMessageContentBlockSchema, SamplingMessageSchema, ServerCapabilitiesSchema, ServerNotificationSchema, ServerRequestSchema, ServerResultSchema, ServerTasksCapabilitySchema, SetLevelRequestParamsSchema, SetLevelRequestSchema, SingleSelectEnumSchemaSchema, StringSchemaSchema, SubscribeRequestParamsSchema, SubscribeRequestSchema, TaskAugmentedRequestParamsSchema, TaskCreationParamsSchema, TaskMetadataSchema, TaskSchema, TaskStatusNotificationParamsSchema, TaskStatusSchema, TextContentSchema, TextResourceContentsSchema, TitledMultiSelectEnumSchemaSchema, TitledSingleSelectEnumSchemaSchema, ToolAnnotationsSchema, ToolChoiceSchema, ToolExecutionSchema, ToolResultContentSchema, ToolSchema, ToolUseContentSchema, UnsubscribeRequestParamsSchema, UnsubscribeRequestSchema, UntitledMultiSelectEnumSchemaSchema, UntitledSingleSelectEnumSchemaSchema, UrlElicitationRequiredError, assertCompleteRequestPrompt, assertCompleteRequestResourceTemplate, isInitializeRequest, isInitializedNotification, isJSONRPCError, isJSONRPCResponse

// EXTERNAL MODULE: ../../node_modules/zod/v4/classic/external.js + 8 modules
var external = __webpack_require__(51518);
;// CONCATENATED MODULE: ../../node_modules/zod/v4/classic/index.js



/* harmony default export */ const classic = ((/* unused pure expression or super */ null && (z)));

;// CONCATENATED MODULE: ../../node_modules/zod/v4/index.js


/* harmony default export */ const v4 = ((/* unused pure expression or super */ null && (z4)));

;// CONCATENATED MODULE: ../../node_modules/@modelcontextprotocol/sdk/dist/esm/types.js

const LATEST_PROTOCOL_VERSION = '2025-11-25';
const DEFAULT_NEGOTIATED_PROTOCOL_VERSION = '2025-03-26';
const SUPPORTED_PROTOCOL_VERSIONS = [LATEST_PROTOCOL_VERSION, '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];
const RELATED_TASK_META_KEY = 'io.modelcontextprotocol/related-task';
/* JSON-RPC types */
const JSONRPC_VERSION = '2.0';
/**
 * Assert 'object' type schema.
 *
 * @internal
 */
const AssertObjectSchema = external/* custom */.IeY((v) => v !== null && (typeof v === 'object' || typeof v === 'function'));
/**
 * A progress token, used to associate progress notifications with the original request.
 */
const ProgressTokenSchema = external/* union */.KCZ([external/* string */.YjP(), external/* number */.aig().int()]);
/**
 * An opaque token used to represent a cursor for pagination.
 */
const CursorSchema = external/* string */.YjP();
/**
 * Task creation parameters, used to ask that the server create a task to represent a request.
 */
const TaskCreationParamsSchema = external/* looseObject */._H3({
    /**
     * Time in milliseconds to keep task results available after completion.
     * If null, the task has unlimited lifetime until manually cleaned up.
     */
    ttl: external/* union */.KCZ([external/* number */.aig(), external/* null */.chJ()]).optional(),
    /**
     * Time in milliseconds to wait between task status requests.
     */
    pollInterval: external/* number */.aig().optional()
});
const TaskMetadataSchema = external/* object */.Ikc({
    ttl: external/* number */.aig().optional()
});
/**
 * Metadata for associating messages with a task.
 * Include this in the `_meta` field under the key `io.modelcontextprotocol/related-task`.
 */
const RelatedTaskMetadataSchema = external/* object */.Ikc({
    taskId: external/* string */.YjP()
});
const RequestMetaSchema = external/* looseObject */._H3({
    /**
     * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
     */
    progressToken: ProgressTokenSchema.optional(),
    /**
     * If specified, this request is related to the provided task.
     */
    [RELATED_TASK_META_KEY]: RelatedTaskMetadataSchema.optional()
});
/**
 * Common params for any request.
 */
const BaseRequestParamsSchema = external/* object */.Ikc({
    /**
     * See [General fields: `_meta`](/specification/draft/basic/index#meta) for notes on `_meta` usage.
     */
    _meta: RequestMetaSchema.optional()
});
/**
 * Common params for any task-augmented request.
 */
const TaskAugmentedRequestParamsSchema = BaseRequestParamsSchema.extend({
    /**
     * If specified, the caller is requesting task-augmented execution for this request.
     * The request will return a CreateTaskResult immediately, and the actual result can be
     * retrieved later via tasks/result.
     *
     * Task augmentation is subject to capability negotiation - receivers MUST declare support
     * for task augmentation of specific request types in their capabilities.
     */
    task: TaskMetadataSchema.optional()
});
/**
 * Checks if a value is a valid TaskAugmentedRequestParams.
 * @param value - The value to check.
 *
 * @returns True if the value is a valid TaskAugmentedRequestParams, false otherwise.
 */
const isTaskAugmentedRequestParams = (value) => TaskAugmentedRequestParamsSchema.safeParse(value).success;
const RequestSchema = external/* object */.Ikc({
    method: external/* string */.YjP(),
    params: BaseRequestParamsSchema.loose().optional()
});
const NotificationsParamsSchema = external/* object */.Ikc({
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: RequestMetaSchema.optional()
});
const NotificationSchema = external/* object */.Ikc({
    method: external/* string */.YjP(),
    params: NotificationsParamsSchema.loose().optional()
});
const ResultSchema = external/* looseObject */._H3({
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: RequestMetaSchema.optional()
});
/**
 * A uniquely identifying ID for a request in JSON-RPC.
 */
const RequestIdSchema = external/* union */.KCZ([external/* string */.YjP(), external/* number */.aig().int()]);
/**
 * A request that expects a response.
 */
const JSONRPCRequestSchema = external/* object */.Ikc({
    jsonrpc: external/* literal */.euz(JSONRPC_VERSION),
    id: RequestIdSchema,
    ...RequestSchema.shape
})
    .strict();
const isJSONRPCRequest = (value) => JSONRPCRequestSchema.safeParse(value).success;
/**
 * A notification which does not expect a response.
 */
const JSONRPCNotificationSchema = external/* object */.Ikc({
    jsonrpc: external/* literal */.euz(JSONRPC_VERSION),
    ...NotificationSchema.shape
})
    .strict();
const isJSONRPCNotification = (value) => JSONRPCNotificationSchema.safeParse(value).success;
/**
 * A successful (non-error) response to a request.
 */
const JSONRPCResultResponseSchema = external/* object */.Ikc({
    jsonrpc: external/* literal */.euz(JSONRPC_VERSION),
    id: RequestIdSchema,
    result: ResultSchema
})
    .strict();
/**
 * Checks if a value is a valid JSONRPCResultResponse.
 * @param value - The value to check.
 *
 * @returns True if the value is a valid JSONRPCResultResponse, false otherwise.
 */
const isJSONRPCResultResponse = (value) => JSONRPCResultResponseSchema.safeParse(value).success;
/**
 * @deprecated Use {@link isJSONRPCResultResponse} instead.
 *
 * Please note that {@link JSONRPCResponse} is a union of {@link JSONRPCResultResponse} and {@link JSONRPCErrorResponse} as per the updated JSON-RPC specification. (was previously just {@link JSONRPCResultResponse})
 */
const isJSONRPCResponse = (/* unused pure expression or super */ null && (isJSONRPCResultResponse));
/**
 * Error codes defined by the JSON-RPC specification.
 */
var ErrorCode;
(function (ErrorCode) {
    // SDK error codes
    ErrorCode[ErrorCode["ConnectionClosed"] = -32000] = "ConnectionClosed";
    ErrorCode[ErrorCode["RequestTimeout"] = -32001] = "RequestTimeout";
    // Standard JSON-RPC error codes
    ErrorCode[ErrorCode["ParseError"] = -32700] = "ParseError";
    ErrorCode[ErrorCode["InvalidRequest"] = -32600] = "InvalidRequest";
    ErrorCode[ErrorCode["MethodNotFound"] = -32601] = "MethodNotFound";
    ErrorCode[ErrorCode["InvalidParams"] = -32602] = "InvalidParams";
    ErrorCode[ErrorCode["InternalError"] = -32603] = "InternalError";
    // MCP-specific error codes
    ErrorCode[ErrorCode["UrlElicitationRequired"] = -32042] = "UrlElicitationRequired";
})(ErrorCode || (ErrorCode = {}));
/**
 * A response to a request that indicates an error occurred.
 */
const JSONRPCErrorResponseSchema = external/* object */.Ikc({
    jsonrpc: external/* literal */.euz(JSONRPC_VERSION),
    id: RequestIdSchema.optional(),
    error: external/* object */.Ikc({
        /**
         * The error type that occurred.
         */
        code: external/* number */.aig().int(),
        /**
         * A short description of the error. The message SHOULD be limited to a concise single sentence.
         */
        message: external/* string */.YjP(),
        /**
         * Additional information about the error. The value of this member is defined by the sender (e.g. detailed error information, nested errors etc.).
         */
        data: external/* unknown */.L5J().optional()
    })
})
    .strict();
/**
 * @deprecated Use {@link JSONRPCErrorResponseSchema} instead.
 */
const JSONRPCErrorSchema = (/* unused pure expression or super */ null && (JSONRPCErrorResponseSchema));
/**
 * Checks if a value is a valid JSONRPCErrorResponse.
 * @param value - The value to check.
 *
 * @returns True if the value is a valid JSONRPCErrorResponse, false otherwise.
 */
const isJSONRPCErrorResponse = (value) => JSONRPCErrorResponseSchema.safeParse(value).success;
/**
 * @deprecated Use {@link isJSONRPCErrorResponse} instead.
 */
const isJSONRPCError = (/* unused pure expression or super */ null && (isJSONRPCErrorResponse));
const JSONRPCMessageSchema = external/* union */.KCZ([
    JSONRPCRequestSchema,
    JSONRPCNotificationSchema,
    JSONRPCResultResponseSchema,
    JSONRPCErrorResponseSchema
]);
const JSONRPCResponseSchema = external/* union */.KCZ([JSONRPCResultResponseSchema, JSONRPCErrorResponseSchema]);
/* Empty result */
/**
 * A response that indicates success but carries no data.
 */
const EmptyResultSchema = ResultSchema.strict();
const CancelledNotificationParamsSchema = NotificationsParamsSchema.extend({
    /**
     * The ID of the request to cancel.
     *
     * This MUST correspond to the ID of a request previously issued in the same direction.
     */
    requestId: RequestIdSchema.optional(),
    /**
     * An optional string describing the reason for the cancellation. This MAY be logged or presented to the user.
     */
    reason: external/* string */.YjP().optional()
});
/* Cancellation */
/**
 * This notification can be sent by either side to indicate that it is cancelling a previously-issued request.
 *
 * The request SHOULD still be in-flight, but due to communication latency, it is always possible that this notification MAY arrive after the request has already finished.
 *
 * This notification indicates that the result will be unused, so any associated processing SHOULD cease.
 *
 * A client MUST NOT attempt to cancel its `initialize` request.
 */
const CancelledNotificationSchema = NotificationSchema.extend({
    method: external/* literal */.euz('notifications/cancelled'),
    params: CancelledNotificationParamsSchema
});
/* Base Metadata */
/**
 * Icon schema for use in tools, prompts, resources, and implementations.
 */
const IconSchema = external/* object */.Ikc({
    /**
     * URL or data URI for the icon.
     */
    src: external/* string */.YjP(),
    /**
     * Optional MIME type for the icon.
     */
    mimeType: external/* string */.YjP().optional(),
    /**
     * Optional array of strings that specify sizes at which the icon can be used.
     * Each string should be in WxH format (e.g., `"48x48"`, `"96x96"`) or `"any"` for scalable formats like SVG.
     *
     * If not provided, the client should assume that the icon can be used at any size.
     */
    sizes: external/* array */.YOg(external/* string */.YjP()).optional(),
    /**
     * Optional specifier for the theme this icon is designed for. `light` indicates
     * the icon is designed to be used with a light background, and `dark` indicates
     * the icon is designed to be used with a dark background.
     *
     * If not provided, the client should assume the icon can be used with any theme.
     */
    theme: external/* enum */.k5n(['light', 'dark']).optional()
});
/**
 * Base schema to add `icons` property.
 *
 */
const IconsSchema = external/* object */.Ikc({
    /**
     * Optional set of sized icons that the client can display in a user interface.
     *
     * Clients that support rendering icons MUST support at least the following MIME types:
     * - `image/png` - PNG images (safe, universal compatibility)
     * - `image/jpeg` (and `image/jpg`) - JPEG images (safe, universal compatibility)
     *
     * Clients that support rendering icons SHOULD also support:
     * - `image/svg+xml` - SVG images (scalable but requires security precautions)
     * - `image/webp` - WebP images (modern, efficient format)
     */
    icons: external/* array */.YOg(IconSchema).optional()
});
/**
 * Base metadata interface for common properties across resources, tools, prompts, and implementations.
 */
const BaseMetadataSchema = external/* object */.Ikc({
    /** Intended for programmatic or logical use, but used as a display name in past specs or fallback */
    name: external/* string */.YjP(),
    /**
     * Intended for UI and end-user contexts — optimized to be human-readable and easily understood,
     * even by those unfamiliar with domain-specific terminology.
     *
     * If not provided, the name should be used for display (except for Tool,
     * where `annotations.title` should be given precedence over using `name`,
     * if present).
     */
    title: external/* string */.YjP().optional()
});
/* Initialization */
/**
 * Describes the name and version of an MCP implementation.
 */
const ImplementationSchema = BaseMetadataSchema.extend({
    ...BaseMetadataSchema.shape,
    ...IconsSchema.shape,
    version: external/* string */.YjP(),
    /**
     * An optional URL of the website for this implementation.
     */
    websiteUrl: external/* string */.YjP().optional(),
    /**
     * An optional human-readable description of what this implementation does.
     *
     * This can be used by clients or servers to provide context about their purpose
     * and capabilities. For example, a server might describe the types of resources
     * or tools it provides, while a client might describe its intended use case.
     */
    description: external/* string */.YjP().optional()
});
const FormElicitationCapabilitySchema = external/* intersection */.E$q(external/* object */.Ikc({
    applyDefaults: external/* boolean */.zMY().optional()
}), external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()));
const ElicitationCapabilitySchema = external/* preprocess */.vkY(value => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (Object.keys(value).length === 0) {
            return { form: {} };
        }
    }
    return value;
}, external/* intersection */.E$q(external/* object */.Ikc({
    form: FormElicitationCapabilitySchema.optional(),
    url: AssertObjectSchema.optional()
}), external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()).optional()));
/**
 * Task capabilities for clients, indicating which request types support task creation.
 */
const ClientTasksCapabilitySchema = external/* looseObject */._H3({
    /**
     * Present if the client supports listing tasks.
     */
    list: AssertObjectSchema.optional(),
    /**
     * Present if the client supports cancelling tasks.
     */
    cancel: AssertObjectSchema.optional(),
    /**
     * Capabilities for task creation on specific request types.
     */
    requests: external/* looseObject */._H3({
        /**
         * Task support for sampling requests.
         */
        sampling: external/* looseObject */._H3({
            createMessage: AssertObjectSchema.optional()
        })
            .optional(),
        /**
         * Task support for elicitation requests.
         */
        elicitation: external/* looseObject */._H3({
            create: AssertObjectSchema.optional()
        })
            .optional()
    })
        .optional()
});
/**
 * Task capabilities for servers, indicating which request types support task creation.
 */
const ServerTasksCapabilitySchema = external/* looseObject */._H3({
    /**
     * Present if the server supports listing tasks.
     */
    list: AssertObjectSchema.optional(),
    /**
     * Present if the server supports cancelling tasks.
     */
    cancel: AssertObjectSchema.optional(),
    /**
     * Capabilities for task creation on specific request types.
     */
    requests: external/* looseObject */._H3({
        /**
         * Task support for tool requests.
         */
        tools: external/* looseObject */._H3({
            call: AssertObjectSchema.optional()
        })
            .optional()
    })
        .optional()
});
/**
 * Capabilities a client may support. Known capabilities are defined here, in this schema, but this is not a closed set: any client can define its own, additional capabilities.
 */
const ClientCapabilitiesSchema = external/* object */.Ikc({
    /**
     * Experimental, non-standard capabilities that the client supports.
     */
    experimental: external/* record */.g1P(external/* string */.YjP(), AssertObjectSchema).optional(),
    /**
     * Present if the client supports sampling from an LLM.
     */
    sampling: external/* object */.Ikc({
        /**
         * Present if the client supports context inclusion via includeContext parameter.
         * If not declared, servers SHOULD only use `includeContext: "none"` (or omit it).
         */
        context: AssertObjectSchema.optional(),
        /**
         * Present if the client supports tool use via tools and toolChoice parameters.
         */
        tools: AssertObjectSchema.optional()
    })
        .optional(),
    /**
     * Present if the client supports eliciting user input.
     */
    elicitation: ElicitationCapabilitySchema.optional(),
    /**
     * Present if the client supports listing roots.
     */
    roots: external/* object */.Ikc({
        /**
         * Whether the client supports issuing notifications for changes to the roots list.
         */
        listChanged: external/* boolean */.zMY().optional()
    })
        .optional(),
    /**
     * Present if the client supports task creation.
     */
    tasks: ClientTasksCapabilitySchema.optional()
});
const InitializeRequestParamsSchema = BaseRequestParamsSchema.extend({
    /**
     * The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well.
     */
    protocolVersion: external/* string */.YjP(),
    capabilities: ClientCapabilitiesSchema,
    clientInfo: ImplementationSchema
});
/**
 * This request is sent from the client to the server when it first connects, asking it to begin initialization.
 */
const InitializeRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('initialize'),
    params: InitializeRequestParamsSchema
});
const isInitializeRequest = (value) => InitializeRequestSchema.safeParse(value).success;
/**
 * Capabilities that a server may support. Known capabilities are defined here, in this schema, but this is not a closed set: any server can define its own, additional capabilities.
 */
const ServerCapabilitiesSchema = external/* object */.Ikc({
    /**
     * Experimental, non-standard capabilities that the server supports.
     */
    experimental: external/* record */.g1P(external/* string */.YjP(), AssertObjectSchema).optional(),
    /**
     * Present if the server supports sending log messages to the client.
     */
    logging: AssertObjectSchema.optional(),
    /**
     * Present if the server supports sending completions to the client.
     */
    completions: AssertObjectSchema.optional(),
    /**
     * Present if the server offers any prompt templates.
     */
    prompts: external/* object */.Ikc({
        /**
         * Whether this server supports issuing notifications for changes to the prompt list.
         */
        listChanged: external/* boolean */.zMY().optional()
    })
        .optional(),
    /**
     * Present if the server offers any resources to read.
     */
    resources: external/* object */.Ikc({
        /**
         * Whether this server supports clients subscribing to resource updates.
         */
        subscribe: external/* boolean */.zMY().optional(),
        /**
         * Whether this server supports issuing notifications for changes to the resource list.
         */
        listChanged: external/* boolean */.zMY().optional()
    })
        .optional(),
    /**
     * Present if the server offers any tools to call.
     */
    tools: external/* object */.Ikc({
        /**
         * Whether this server supports issuing notifications for changes to the tool list.
         */
        listChanged: external/* boolean */.zMY().optional()
    })
        .optional(),
    /**
     * Present if the server supports task creation.
     */
    tasks: ServerTasksCapabilitySchema.optional()
});
/**
 * After receiving an initialize request from the client, the server sends this response.
 */
const InitializeResultSchema = ResultSchema.extend({
    /**
     * The version of the Model Context Protocol that the server wants to use. This may not match the version that the client requested. If the client cannot support this version, it MUST disconnect.
     */
    protocolVersion: external/* string */.YjP(),
    capabilities: ServerCapabilitiesSchema,
    serverInfo: ImplementationSchema,
    /**
     * Instructions describing how to use the server and its features.
     *
     * This can be used by clients to improve the LLM's understanding of available tools, resources, etc. It can be thought of like a "hint" to the model. For example, this information MAY be added to the system prompt.
     */
    instructions: external/* string */.YjP().optional()
});
/**
 * This notification is sent from the client to the server after initialization has finished.
 */
const InitializedNotificationSchema = NotificationSchema.extend({
    method: external/* literal */.euz('notifications/initialized'),
    params: NotificationsParamsSchema.optional()
});
const isInitializedNotification = (value) => InitializedNotificationSchema.safeParse(value).success;
/* Ping */
/**
 * A ping, issued by either the server or the client, to check that the other party is still alive. The receiver must promptly respond, or else may be disconnected.
 */
const PingRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('ping'),
    params: BaseRequestParamsSchema.optional()
});
/* Progress notifications */
const ProgressSchema = external/* object */.Ikc({
    /**
     * The progress thus far. This should increase every time progress is made, even if the total is unknown.
     */
    progress: external/* number */.aig(),
    /**
     * Total number of items to process (or total progress required), if known.
     */
    total: external/* optional */.lqM(external/* number */.aig()),
    /**
     * An optional message describing the current progress.
     */
    message: external/* optional */.lqM(external/* string */.YjP())
});
const ProgressNotificationParamsSchema = external/* object */.Ikc({
    ...NotificationsParamsSchema.shape,
    ...ProgressSchema.shape,
    /**
     * The progress token which was given in the initial request, used to associate this notification with the request that is proceeding.
     */
    progressToken: ProgressTokenSchema
});
/**
 * An out-of-band notification used to inform the receiver of a progress update for a long-running request.
 *
 * @category notifications/progress
 */
const ProgressNotificationSchema = NotificationSchema.extend({
    method: external/* literal */.euz('notifications/progress'),
    params: ProgressNotificationParamsSchema
});
const PaginatedRequestParamsSchema = BaseRequestParamsSchema.extend({
    /**
     * An opaque token representing the current pagination position.
     * If provided, the server should return results starting after this cursor.
     */
    cursor: CursorSchema.optional()
});
/* Pagination */
const PaginatedRequestSchema = RequestSchema.extend({
    params: PaginatedRequestParamsSchema.optional()
});
const PaginatedResultSchema = ResultSchema.extend({
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: CursorSchema.optional()
});
/**
 * The status of a task.
 * */
const TaskStatusSchema = external/* enum */.k5n(['working', 'input_required', 'completed', 'failed', 'cancelled']);
/* Tasks */
/**
 * A pollable state object associated with a request.
 */
const TaskSchema = external/* object */.Ikc({
    taskId: external/* string */.YjP(),
    status: TaskStatusSchema,
    /**
     * Time in milliseconds to keep task results available after completion.
     * If null, the task has unlimited lifetime until manually cleaned up.
     */
    ttl: external/* union */.KCZ([external/* number */.aig(), external/* null */.chJ()]),
    /**
     * ISO 8601 timestamp when the task was created.
     */
    createdAt: external/* string */.YjP(),
    /**
     * ISO 8601 timestamp when the task was last updated.
     */
    lastUpdatedAt: external/* string */.YjP(),
    pollInterval: external/* optional */.lqM(external/* number */.aig()),
    /**
     * Optional diagnostic message for failed tasks or other status information.
     */
    statusMessage: external/* optional */.lqM(external/* string */.YjP())
});
/**
 * Result returned when a task is created, containing the task data wrapped in a task field.
 */
const CreateTaskResultSchema = ResultSchema.extend({
    task: TaskSchema
});
/**
 * Parameters for task status notification.
 */
const TaskStatusNotificationParamsSchema = NotificationsParamsSchema.merge(TaskSchema);
/**
 * A notification sent when a task's status changes.
 */
const TaskStatusNotificationSchema = NotificationSchema.extend({
    method: external/* literal */.euz('notifications/tasks/status'),
    params: TaskStatusNotificationParamsSchema
});
/**
 * A request to get the state of a specific task.
 */
const GetTaskRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('tasks/get'),
    params: BaseRequestParamsSchema.extend({
        taskId: external/* string */.YjP()
    })
});
/**
 * The response to a tasks/get request.
 */
const GetTaskResultSchema = ResultSchema.merge(TaskSchema);
/**
 * A request to get the result of a specific task.
 */
const GetTaskPayloadRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('tasks/result'),
    params: BaseRequestParamsSchema.extend({
        taskId: external/* string */.YjP()
    })
});
/**
 * The response to a tasks/result request.
 * The structure matches the result type of the original request.
 * For example, a tools/call task would return the CallToolResult structure.
 *
 */
const GetTaskPayloadResultSchema = ResultSchema.loose();
/**
 * A request to list tasks.
 */
const ListTasksRequestSchema = PaginatedRequestSchema.extend({
    method: external/* literal */.euz('tasks/list')
});
/**
 * The response to a tasks/list request.
 */
const ListTasksResultSchema = PaginatedResultSchema.extend({
    tasks: external/* array */.YOg(TaskSchema)
});
/**
 * A request to cancel a specific task.
 */
const CancelTaskRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('tasks/cancel'),
    params: BaseRequestParamsSchema.extend({
        taskId: external/* string */.YjP()
    })
});
/**
 * The response to a tasks/cancel request.
 */
const CancelTaskResultSchema = ResultSchema.merge(TaskSchema);
/* Resources */
/**
 * The contents of a specific resource or sub-resource.
 */
const ResourceContentsSchema = external/* object */.Ikc({
    /**
     * The URI of this resource.
     */
    uri: external/* string */.YjP(),
    /**
     * The MIME type of this resource, if known.
     */
    mimeType: external/* optional */.lqM(external/* string */.YjP()),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()).optional()
});
const TextResourceContentsSchema = ResourceContentsSchema.extend({
    /**
     * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
     */
    text: external/* string */.YjP()
});
/**
 * A Zod schema for validating Base64 strings that is more performant and
 * robust for very large inputs than the default regex-based check. It avoids
 * stack overflows by using the native `atob` function for validation.
 */
const Base64Schema = external/* string */.YjP().refine(val => {
    try {
        // atob throws a DOMException if the string contains characters
        // that are not part of the Base64 character set.
        atob(val);
        return true;
    }
    catch {
        return false;
    }
}, { message: 'Invalid Base64 string' });
const BlobResourceContentsSchema = ResourceContentsSchema.extend({
    /**
     * A base64-encoded string representing the binary data of the item.
     */
    blob: Base64Schema
});
/**
 * The sender or recipient of messages and data in a conversation.
 */
const RoleSchema = external/* enum */.k5n(['user', 'assistant']);
/**
 * Optional annotations providing clients additional context about a resource.
 */
const AnnotationsSchema = external/* object */.Ikc({
    /**
     * Intended audience(s) for the resource.
     */
    audience: external/* array */.YOg(RoleSchema).optional(),
    /**
     * Importance hint for the resource, from 0 (least) to 1 (most).
     */
    priority: external/* number */.aig().min(0).max(1).optional(),
    /**
     * ISO 8601 timestamp for the most recent modification.
     */
    lastModified: external/* iso.datetime */.KH5.datetime({ offset: true }).optional()
});
/**
 * A known resource that the server is capable of reading.
 */
const ResourceSchema = external/* object */.Ikc({
    ...BaseMetadataSchema.shape,
    ...IconsSchema.shape,
    /**
     * The URI of this resource.
     */
    uri: external/* string */.YjP(),
    /**
     * A description of what this resource represents.
     *
     * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
     */
    description: external/* optional */.lqM(external/* string */.YjP()),
    /**
     * The MIME type of this resource, if known.
     */
    mimeType: external/* optional */.lqM(external/* string */.YjP()),
    /**
     * Optional annotations for the client.
     */
    annotations: AnnotationsSchema.optional(),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: external/* optional */.lqM(external/* looseObject */._H3({}))
});
/**
 * A template description for resources available on the server.
 */
const ResourceTemplateSchema = external/* object */.Ikc({
    ...BaseMetadataSchema.shape,
    ...IconsSchema.shape,
    /**
     * A URI template (according to RFC 6570) that can be used to construct resource URIs.
     */
    uriTemplate: external/* string */.YjP(),
    /**
     * A description of what this template is for.
     *
     * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
     */
    description: external/* optional */.lqM(external/* string */.YjP()),
    /**
     * The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type.
     */
    mimeType: external/* optional */.lqM(external/* string */.YjP()),
    /**
     * Optional annotations for the client.
     */
    annotations: AnnotationsSchema.optional(),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: external/* optional */.lqM(external/* looseObject */._H3({}))
});
/**
 * Sent from the client to request a list of resources the server has.
 */
const ListResourcesRequestSchema = PaginatedRequestSchema.extend({
    method: external/* literal */.euz('resources/list')
});
/**
 * The server's response to a resources/list request from the client.
 */
const ListResourcesResultSchema = PaginatedResultSchema.extend({
    resources: external/* array */.YOg(ResourceSchema)
});
/**
 * Sent from the client to request a list of resource templates the server has.
 */
const ListResourceTemplatesRequestSchema = PaginatedRequestSchema.extend({
    method: external/* literal */.euz('resources/templates/list')
});
/**
 * The server's response to a resources/templates/list request from the client.
 */
const ListResourceTemplatesResultSchema = PaginatedResultSchema.extend({
    resourceTemplates: external/* array */.YOg(ResourceTemplateSchema)
});
const ResourceRequestParamsSchema = BaseRequestParamsSchema.extend({
    /**
     * The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it.
     *
     * @format uri
     */
    uri: external/* string */.YjP()
});
/**
 * Parameters for a `resources/read` request.
 */
const ReadResourceRequestParamsSchema = ResourceRequestParamsSchema;
/**
 * Sent from the client to the server, to read a specific resource URI.
 */
const ReadResourceRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('resources/read'),
    params: ReadResourceRequestParamsSchema
});
/**
 * The server's response to a resources/read request from the client.
 */
const ReadResourceResultSchema = ResultSchema.extend({
    contents: external/* array */.YOg(external/* union */.KCZ([TextResourceContentsSchema, BlobResourceContentsSchema]))
});
/**
 * An optional notification from the server to the client, informing it that the list of resources it can read from has changed. This may be issued by servers without any previous subscription from the client.
 */
const ResourceListChangedNotificationSchema = NotificationSchema.extend({
    method: external/* literal */.euz('notifications/resources/list_changed'),
    params: NotificationsParamsSchema.optional()
});
const SubscribeRequestParamsSchema = ResourceRequestParamsSchema;
/**
 * Sent from the client to request resources/updated notifications from the server whenever a particular resource changes.
 */
const SubscribeRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('resources/subscribe'),
    params: SubscribeRequestParamsSchema
});
const UnsubscribeRequestParamsSchema = ResourceRequestParamsSchema;
/**
 * Sent from the client to request cancellation of resources/updated notifications from the server. This should follow a previous resources/subscribe request.
 */
const UnsubscribeRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('resources/unsubscribe'),
    params: UnsubscribeRequestParamsSchema
});
/**
 * Parameters for a `notifications/resources/updated` notification.
 */
const ResourceUpdatedNotificationParamsSchema = NotificationsParamsSchema.extend({
    /**
     * The URI of the resource that has been updated. This might be a sub-resource of the one that the client actually subscribed to.
     */
    uri: external/* string */.YjP()
});
/**
 * A notification from the server to the client, informing it that a resource has changed and may need to be read again. This should only be sent if the client previously sent a resources/subscribe request.
 */
const ResourceUpdatedNotificationSchema = NotificationSchema.extend({
    method: external/* literal */.euz('notifications/resources/updated'),
    params: ResourceUpdatedNotificationParamsSchema
});
/* Prompts */
/**
 * Describes an argument that a prompt can accept.
 */
const PromptArgumentSchema = external/* object */.Ikc({
    /**
     * The name of the argument.
     */
    name: external/* string */.YjP(),
    /**
     * A human-readable description of the argument.
     */
    description: external/* optional */.lqM(external/* string */.YjP()),
    /**
     * Whether this argument must be provided.
     */
    required: external/* optional */.lqM(external/* boolean */.zMY())
});
/**
 * A prompt or prompt template that the server offers.
 */
const PromptSchema = external/* object */.Ikc({
    ...BaseMetadataSchema.shape,
    ...IconsSchema.shape,
    /**
     * An optional description of what this prompt provides
     */
    description: external/* optional */.lqM(external/* string */.YjP()),
    /**
     * A list of arguments to use for templating the prompt.
     */
    arguments: external/* optional */.lqM(external/* array */.YOg(PromptArgumentSchema)),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: external/* optional */.lqM(external/* looseObject */._H3({}))
});
/**
 * Sent from the client to request a list of prompts and prompt templates the server has.
 */
const ListPromptsRequestSchema = PaginatedRequestSchema.extend({
    method: external/* literal */.euz('prompts/list')
});
/**
 * The server's response to a prompts/list request from the client.
 */
const ListPromptsResultSchema = PaginatedResultSchema.extend({
    prompts: external/* array */.YOg(PromptSchema)
});
/**
 * Parameters for a `prompts/get` request.
 */
const GetPromptRequestParamsSchema = BaseRequestParamsSchema.extend({
    /**
     * The name of the prompt or prompt template.
     */
    name: external/* string */.YjP(),
    /**
     * Arguments to use for templating the prompt.
     */
    arguments: external/* record */.g1P(external/* string */.YjP(), external/* string */.YjP()).optional()
});
/**
 * Used by the client to get a prompt provided by the server.
 */
const GetPromptRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('prompts/get'),
    params: GetPromptRequestParamsSchema
});
/**
 * Text provided to or from an LLM.
 */
const TextContentSchema = external/* object */.Ikc({
    type: external/* literal */.euz('text'),
    /**
     * The text content of the message.
     */
    text: external/* string */.YjP(),
    /**
     * Optional annotations for the client.
     */
    annotations: AnnotationsSchema.optional(),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()).optional()
});
/**
 * An image provided to or from an LLM.
 */
const ImageContentSchema = external/* object */.Ikc({
    type: external/* literal */.euz('image'),
    /**
     * The base64-encoded image data.
     */
    data: Base64Schema,
    /**
     * The MIME type of the image. Different providers may support different image types.
     */
    mimeType: external/* string */.YjP(),
    /**
     * Optional annotations for the client.
     */
    annotations: AnnotationsSchema.optional(),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()).optional()
});
/**
 * An Audio provided to or from an LLM.
 */
const AudioContentSchema = external/* object */.Ikc({
    type: external/* literal */.euz('audio'),
    /**
     * The base64-encoded audio data.
     */
    data: Base64Schema,
    /**
     * The MIME type of the audio. Different providers may support different audio types.
     */
    mimeType: external/* string */.YjP(),
    /**
     * Optional annotations for the client.
     */
    annotations: AnnotationsSchema.optional(),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()).optional()
});
/**
 * A tool call request from an assistant (LLM).
 * Represents the assistant's request to use a tool.
 */
const ToolUseContentSchema = external/* object */.Ikc({
    type: external/* literal */.euz('tool_use'),
    /**
     * The name of the tool to invoke.
     * Must match a tool name from the request's tools array.
     */
    name: external/* string */.YjP(),
    /**
     * Unique identifier for this tool call.
     * Used to correlate with ToolResultContent in subsequent messages.
     */
    id: external/* string */.YjP(),
    /**
     * Arguments to pass to the tool.
     * Must conform to the tool's inputSchema.
     */
    input: external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()).optional()
});
/**
 * The contents of a resource, embedded into a prompt or tool call result.
 */
const EmbeddedResourceSchema = external/* object */.Ikc({
    type: external/* literal */.euz('resource'),
    resource: external/* union */.KCZ([TextResourceContentsSchema, BlobResourceContentsSchema]),
    /**
     * Optional annotations for the client.
     */
    annotations: AnnotationsSchema.optional(),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()).optional()
});
/**
 * A resource that the server is capable of reading, included in a prompt or tool call result.
 *
 * Note: resource links returned by tools are not guaranteed to appear in the results of `resources/list` requests.
 */
const ResourceLinkSchema = ResourceSchema.extend({
    type: external/* literal */.euz('resource_link')
});
/**
 * A content block that can be used in prompts and tool results.
 */
const ContentBlockSchema = external/* union */.KCZ([
    TextContentSchema,
    ImageContentSchema,
    AudioContentSchema,
    ResourceLinkSchema,
    EmbeddedResourceSchema
]);
/**
 * Describes a message returned as part of a prompt.
 */
const PromptMessageSchema = external/* object */.Ikc({
    role: RoleSchema,
    content: ContentBlockSchema
});
/**
 * The server's response to a prompts/get request from the client.
 */
const GetPromptResultSchema = ResultSchema.extend({
    /**
     * An optional description for the prompt.
     */
    description: external/* string */.YjP().optional(),
    messages: external/* array */.YOg(PromptMessageSchema)
});
/**
 * An optional notification from the server to the client, informing it that the list of prompts it offers has changed. This may be issued by servers without any previous subscription from the client.
 */
const PromptListChangedNotificationSchema = NotificationSchema.extend({
    method: external/* literal */.euz('notifications/prompts/list_changed'),
    params: NotificationsParamsSchema.optional()
});
/* Tools */
/**
 * Additional properties describing a Tool to clients.
 *
 * NOTE: all properties in ToolAnnotations are **hints**.
 * They are not guaranteed to provide a faithful description of
 * tool behavior (including descriptive properties like `title`).
 *
 * Clients should never make tool use decisions based on ToolAnnotations
 * received from untrusted servers.
 */
const ToolAnnotationsSchema = external/* object */.Ikc({
    /**
     * A human-readable title for the tool.
     */
    title: external/* string */.YjP().optional(),
    /**
     * If true, the tool does not modify its environment.
     *
     * Default: false
     */
    readOnlyHint: external/* boolean */.zMY().optional(),
    /**
     * If true, the tool may perform destructive updates to its environment.
     * If false, the tool performs only additive updates.
     *
     * (This property is meaningful only when `readOnlyHint == false`)
     *
     * Default: true
     */
    destructiveHint: external/* boolean */.zMY().optional(),
    /**
     * If true, calling the tool repeatedly with the same arguments
     * will have no additional effect on the its environment.
     *
     * (This property is meaningful only when `readOnlyHint == false`)
     *
     * Default: false
     */
    idempotentHint: external/* boolean */.zMY().optional(),
    /**
     * If true, this tool may interact with an "open world" of external
     * entities. If false, the tool's domain of interaction is closed.
     * For example, the world of a web search tool is open, whereas that
     * of a memory tool is not.
     *
     * Default: true
     */
    openWorldHint: external/* boolean */.zMY().optional()
});
/**
 * Execution-related properties for a tool.
 */
const ToolExecutionSchema = external/* object */.Ikc({
    /**
     * Indicates the tool's preference for task-augmented execution.
     * - "required": Clients MUST invoke the tool as a task
     * - "optional": Clients MAY invoke the tool as a task or normal request
     * - "forbidden": Clients MUST NOT attempt to invoke the tool as a task
     *
     * If not present, defaults to "forbidden".
     */
    taskSupport: external/* enum */.k5n(['required', 'optional', 'forbidden']).optional()
});
/**
 * Definition for a tool the client can call.
 */
const ToolSchema = external/* object */.Ikc({
    ...BaseMetadataSchema.shape,
    ...IconsSchema.shape,
    /**
     * A human-readable description of the tool.
     */
    description: external/* string */.YjP().optional(),
    /**
     * A JSON Schema 2020-12 object defining the expected parameters for the tool.
     * Must have type: 'object' at the root level per MCP spec.
     */
    inputSchema: external/* object */.Ikc({
        type: external/* literal */.euz('object'),
        properties: external/* record */.g1P(external/* string */.YjP(), AssertObjectSchema).optional(),
        required: external/* array */.YOg(external/* string */.YjP()).optional()
    })
        .catchall(external/* unknown */.L5J()),
    /**
     * An optional JSON Schema 2020-12 object defining the structure of the tool's output
     * returned in the structuredContent field of a CallToolResult.
     * Must have type: 'object' at the root level per MCP spec.
     */
    outputSchema: external/* object */.Ikc({
        type: external/* literal */.euz('object'),
        properties: external/* record */.g1P(external/* string */.YjP(), AssertObjectSchema).optional(),
        required: external/* array */.YOg(external/* string */.YjP()).optional()
    })
        .catchall(external/* unknown */.L5J())
        .optional(),
    /**
     * Optional additional tool information.
     */
    annotations: ToolAnnotationsSchema.optional(),
    /**
     * Execution-related properties for this tool.
     */
    execution: ToolExecutionSchema.optional(),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()).optional()
});
/**
 * Sent from the client to request a list of tools the server has.
 */
const ListToolsRequestSchema = PaginatedRequestSchema.extend({
    method: external/* literal */.euz('tools/list')
});
/**
 * The server's response to a tools/list request from the client.
 */
const ListToolsResultSchema = PaginatedResultSchema.extend({
    tools: external/* array */.YOg(ToolSchema)
});
/**
 * The server's response to a tool call.
 */
const CallToolResultSchema = ResultSchema.extend({
    /**
     * A list of content objects that represent the result of the tool call.
     *
     * If the Tool does not define an outputSchema, this field MUST be present in the result.
     * For backwards compatibility, this field is always present, but it may be empty.
     */
    content: external/* array */.YOg(ContentBlockSchema).default([]),
    /**
     * An object containing structured tool output.
     *
     * If the Tool defines an outputSchema, this field MUST be present in the result, and contain a JSON object that matches the schema.
     */
    structuredContent: external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()).optional(),
    /**
     * Whether the tool call ended in an error.
     *
     * If not set, this is assumed to be false (the call was successful).
     *
     * Any errors that originate from the tool SHOULD be reported inside the result
     * object, with `isError` set to true, _not_ as an MCP protocol-level error
     * response. Otherwise, the LLM would not be able to see that an error occurred
     * and self-correct.
     *
     * However, any errors in _finding_ the tool, an error indicating that the
     * server does not support tool calls, or any other exceptional conditions,
     * should be reported as an MCP error response.
     */
    isError: external/* boolean */.zMY().optional()
});
/**
 * CallToolResultSchema extended with backwards compatibility to protocol version 2024-10-07.
 */
const CompatibilityCallToolResultSchema = CallToolResultSchema.or(ResultSchema.extend({
    toolResult: external/* unknown */.L5J()
}));
/**
 * Parameters for a `tools/call` request.
 */
const CallToolRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
    /**
     * The name of the tool to call.
     */
    name: external/* string */.YjP(),
    /**
     * Arguments to pass to the tool.
     */
    arguments: external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()).optional()
});
/**
 * Used by the client to invoke a tool provided by the server.
 */
const CallToolRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('tools/call'),
    params: CallToolRequestParamsSchema
});
/**
 * An optional notification from the server to the client, informing it that the list of tools it offers has changed. This may be issued by servers without any previous subscription from the client.
 */
const ToolListChangedNotificationSchema = NotificationSchema.extend({
    method: external/* literal */.euz('notifications/tools/list_changed'),
    params: NotificationsParamsSchema.optional()
});
/**
 * Base schema for list changed subscription options (without callback).
 * Used internally for Zod validation of autoRefresh and debounceMs.
 */
const ListChangedOptionsBaseSchema = external/* object */.Ikc({
    /**
     * If true, the list will be refreshed automatically when a list changed notification is received.
     * The callback will be called with the updated list.
     *
     * If false, the callback will be called with null items, allowing manual refresh.
     *
     * @default true
     */
    autoRefresh: external/* boolean */.zMY().default(true),
    /**
     * Debounce time in milliseconds for list changed notification processing.
     *
     * Multiple notifications received within this timeframe will only trigger one refresh.
     * Set to 0 to disable debouncing.
     *
     * @default 300
     */
    debounceMs: external/* number */.aig().int().nonnegative().default(300)
});
/* Logging */
/**
 * The severity of a log message.
 */
const LoggingLevelSchema = external/* enum */.k5n(['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']);
/**
 * Parameters for a `logging/setLevel` request.
 */
const SetLevelRequestParamsSchema = BaseRequestParamsSchema.extend({
    /**
     * The level of logging that the client wants to receive from the server. The server should send all logs at this level and higher (i.e., more severe) to the client as notifications/logging/message.
     */
    level: LoggingLevelSchema
});
/**
 * A request from the client to the server, to enable or adjust logging.
 */
const SetLevelRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('logging/setLevel'),
    params: SetLevelRequestParamsSchema
});
/**
 * Parameters for a `notifications/message` notification.
 */
const LoggingMessageNotificationParamsSchema = NotificationsParamsSchema.extend({
    /**
     * The severity of this log message.
     */
    level: LoggingLevelSchema,
    /**
     * An optional name of the logger issuing this message.
     */
    logger: external/* string */.YjP().optional(),
    /**
     * The data to be logged, such as a string message or an object. Any JSON serializable type is allowed here.
     */
    data: external/* unknown */.L5J()
});
/**
 * Notification of a log message passed from server to client. If no logging/setLevel request has been sent from the client, the server MAY decide which messages to send automatically.
 */
const LoggingMessageNotificationSchema = NotificationSchema.extend({
    method: external/* literal */.euz('notifications/message'),
    params: LoggingMessageNotificationParamsSchema
});
/* Sampling */
/**
 * Hints to use for model selection.
 */
const ModelHintSchema = external/* object */.Ikc({
    /**
     * A hint for a model name.
     */
    name: external/* string */.YjP().optional()
});
/**
 * The server's preferences for model selection, requested of the client during sampling.
 */
const ModelPreferencesSchema = external/* object */.Ikc({
    /**
     * Optional hints to use for model selection.
     */
    hints: external/* array */.YOg(ModelHintSchema).optional(),
    /**
     * How much to prioritize cost when selecting a model.
     */
    costPriority: external/* number */.aig().min(0).max(1).optional(),
    /**
     * How much to prioritize sampling speed (latency) when selecting a model.
     */
    speedPriority: external/* number */.aig().min(0).max(1).optional(),
    /**
     * How much to prioritize intelligence and capabilities when selecting a model.
     */
    intelligencePriority: external/* number */.aig().min(0).max(1).optional()
});
/**
 * Controls tool usage behavior in sampling requests.
 */
const ToolChoiceSchema = external/* object */.Ikc({
    /**
     * Controls when tools are used:
     * - "auto": Model decides whether to use tools (default)
     * - "required": Model MUST use at least one tool before completing
     * - "none": Model MUST NOT use any tools
     */
    mode: external/* enum */.k5n(['auto', 'required', 'none']).optional()
});
/**
 * The result of a tool execution, provided by the user (server).
 * Represents the outcome of invoking a tool requested via ToolUseContent.
 */
const ToolResultContentSchema = external/* object */.Ikc({
    type: external/* literal */.euz('tool_result'),
    toolUseId: external/* string */.YjP().describe('The unique identifier for the corresponding tool call.'),
    content: external/* array */.YOg(ContentBlockSchema).default([]),
    structuredContent: external/* object */.Ikc({}).loose().optional(),
    isError: external/* boolean */.zMY().optional(),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()).optional()
});
/**
 * Basic content types for sampling responses (without tool use).
 * Used for backwards-compatible CreateMessageResult when tools are not used.
 */
const SamplingContentSchema = external/* discriminatedUnion */.gMt('type', [TextContentSchema, ImageContentSchema, AudioContentSchema]);
/**
 * Content block types allowed in sampling messages.
 * This includes text, image, audio, tool use requests, and tool results.
 */
const SamplingMessageContentBlockSchema = external/* discriminatedUnion */.gMt('type', [
    TextContentSchema,
    ImageContentSchema,
    AudioContentSchema,
    ToolUseContentSchema,
    ToolResultContentSchema
]);
/**
 * Describes a message issued to or received from an LLM API.
 */
const SamplingMessageSchema = external/* object */.Ikc({
    role: RoleSchema,
    content: external/* union */.KCZ([SamplingMessageContentBlockSchema, external/* array */.YOg(SamplingMessageContentBlockSchema)]),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()).optional()
});
/**
 * Parameters for a `sampling/createMessage` request.
 */
const CreateMessageRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
    messages: external/* array */.YOg(SamplingMessageSchema),
    /**
     * The server's preferences for which model to select. The client MAY modify or omit this request.
     */
    modelPreferences: ModelPreferencesSchema.optional(),
    /**
     * An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt.
     */
    systemPrompt: external/* string */.YjP().optional(),
    /**
     * A request to include context from one or more MCP servers (including the caller), to be attached to the prompt.
     * The client MAY ignore this request.
     *
     * Default is "none". Values "thisServer" and "allServers" are soft-deprecated. Servers SHOULD only use these values if the client
     * declares ClientCapabilities.sampling.context. These values may be removed in future spec releases.
     */
    includeContext: external/* enum */.k5n(['none', 'thisServer', 'allServers']).optional(),
    temperature: external/* number */.aig().optional(),
    /**
     * The requested maximum number of tokens to sample (to prevent runaway completions).
     *
     * The client MAY choose to sample fewer tokens than the requested maximum.
     */
    maxTokens: external/* number */.aig().int(),
    stopSequences: external/* array */.YOg(external/* string */.YjP()).optional(),
    /**
     * Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific.
     */
    metadata: AssertObjectSchema.optional(),
    /**
     * Tools that the model may use during generation.
     * The client MUST return an error if this field is provided but ClientCapabilities.sampling.tools is not declared.
     */
    tools: external/* array */.YOg(ToolSchema).optional(),
    /**
     * Controls how the model uses tools.
     * The client MUST return an error if this field is provided but ClientCapabilities.sampling.tools is not declared.
     * Default is `{ mode: "auto" }`.
     */
    toolChoice: ToolChoiceSchema.optional()
});
/**
 * A request from the server to sample an LLM via the client. The client has full discretion over which model to select. The client should also inform the user before beginning sampling, to allow them to inspect the request (human in the loop) and decide whether to approve it.
 */
const CreateMessageRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('sampling/createMessage'),
    params: CreateMessageRequestParamsSchema
});
/**
 * The client's response to a sampling/create_message request from the server.
 * This is the backwards-compatible version that returns single content (no arrays).
 * Used when the request does not include tools.
 */
const CreateMessageResultSchema = ResultSchema.extend({
    /**
     * The name of the model that generated the message.
     */
    model: external/* string */.YjP(),
    /**
     * The reason why sampling stopped, if known.
     *
     * Standard values:
     * - "endTurn": Natural end of the assistant's turn
     * - "stopSequence": A stop sequence was encountered
     * - "maxTokens": Maximum token limit was reached
     *
     * This field is an open string to allow for provider-specific stop reasons.
     */
    stopReason: external/* optional */.lqM(external/* enum */.k5n(['endTurn', 'stopSequence', 'maxTokens']).or(external/* string */.YjP())),
    role: RoleSchema,
    /**
     * Response content. Single content block (text, image, or audio).
     */
    content: SamplingContentSchema
});
/**
 * The client's response to a sampling/create_message request when tools were provided.
 * This version supports array content for tool use flows.
 */
const CreateMessageResultWithToolsSchema = ResultSchema.extend({
    /**
     * The name of the model that generated the message.
     */
    model: external/* string */.YjP(),
    /**
     * The reason why sampling stopped, if known.
     *
     * Standard values:
     * - "endTurn": Natural end of the assistant's turn
     * - "stopSequence": A stop sequence was encountered
     * - "maxTokens": Maximum token limit was reached
     * - "toolUse": The model wants to use one or more tools
     *
     * This field is an open string to allow for provider-specific stop reasons.
     */
    stopReason: external/* optional */.lqM(external/* enum */.k5n(['endTurn', 'stopSequence', 'maxTokens', 'toolUse']).or(external/* string */.YjP())),
    role: RoleSchema,
    /**
     * Response content. May be a single block or array. May include ToolUseContent if stopReason is "toolUse".
     */
    content: external/* union */.KCZ([SamplingMessageContentBlockSchema, external/* array */.YOg(SamplingMessageContentBlockSchema)])
});
/* Elicitation */
/**
 * Primitive schema definition for boolean fields.
 */
const BooleanSchemaSchema = external/* object */.Ikc({
    type: external/* literal */.euz('boolean'),
    title: external/* string */.YjP().optional(),
    description: external/* string */.YjP().optional(),
    default: external/* boolean */.zMY().optional()
});
/**
 * Primitive schema definition for string fields.
 */
const StringSchemaSchema = external/* object */.Ikc({
    type: external/* literal */.euz('string'),
    title: external/* string */.YjP().optional(),
    description: external/* string */.YjP().optional(),
    minLength: external/* number */.aig().optional(),
    maxLength: external/* number */.aig().optional(),
    format: external/* enum */.k5n(['email', 'uri', 'date', 'date-time']).optional(),
    default: external/* string */.YjP().optional()
});
/**
 * Primitive schema definition for number fields.
 */
const NumberSchemaSchema = external/* object */.Ikc({
    type: external/* enum */.k5n(['number', 'integer']),
    title: external/* string */.YjP().optional(),
    description: external/* string */.YjP().optional(),
    minimum: external/* number */.aig().optional(),
    maximum: external/* number */.aig().optional(),
    default: external/* number */.aig().optional()
});
/**
 * Schema for single-selection enumeration without display titles for options.
 */
const UntitledSingleSelectEnumSchemaSchema = external/* object */.Ikc({
    type: external/* literal */.euz('string'),
    title: external/* string */.YjP().optional(),
    description: external/* string */.YjP().optional(),
    enum: external/* array */.YOg(external/* string */.YjP()),
    default: external/* string */.YjP().optional()
});
/**
 * Schema for single-selection enumeration with display titles for each option.
 */
const TitledSingleSelectEnumSchemaSchema = external/* object */.Ikc({
    type: external/* literal */.euz('string'),
    title: external/* string */.YjP().optional(),
    description: external/* string */.YjP().optional(),
    oneOf: external/* array */.YOg(external/* object */.Ikc({
        const: external/* string */.YjP(),
        title: external/* string */.YjP()
    })),
    default: external/* string */.YjP().optional()
});
/**
 * Use TitledSingleSelectEnumSchema instead.
 * This interface will be removed in a future version.
 */
const LegacyTitledEnumSchemaSchema = external/* object */.Ikc({
    type: external/* literal */.euz('string'),
    title: external/* string */.YjP().optional(),
    description: external/* string */.YjP().optional(),
    enum: external/* array */.YOg(external/* string */.YjP()),
    enumNames: external/* array */.YOg(external/* string */.YjP()).optional(),
    default: external/* string */.YjP().optional()
});
// Combined single selection enumeration
const SingleSelectEnumSchemaSchema = external/* union */.KCZ([UntitledSingleSelectEnumSchemaSchema, TitledSingleSelectEnumSchemaSchema]);
/**
 * Schema for multiple-selection enumeration without display titles for options.
 */
const UntitledMultiSelectEnumSchemaSchema = external/* object */.Ikc({
    type: external/* literal */.euz('array'),
    title: external/* string */.YjP().optional(),
    description: external/* string */.YjP().optional(),
    minItems: external/* number */.aig().optional(),
    maxItems: external/* number */.aig().optional(),
    items: external/* object */.Ikc({
        type: external/* literal */.euz('string'),
        enum: external/* array */.YOg(external/* string */.YjP())
    }),
    default: external/* array */.YOg(external/* string */.YjP()).optional()
});
/**
 * Schema for multiple-selection enumeration with display titles for each option.
 */
const TitledMultiSelectEnumSchemaSchema = external/* object */.Ikc({
    type: external/* literal */.euz('array'),
    title: external/* string */.YjP().optional(),
    description: external/* string */.YjP().optional(),
    minItems: external/* number */.aig().optional(),
    maxItems: external/* number */.aig().optional(),
    items: external/* object */.Ikc({
        anyOf: external/* array */.YOg(external/* object */.Ikc({
            const: external/* string */.YjP(),
            title: external/* string */.YjP()
        }))
    }),
    default: external/* array */.YOg(external/* string */.YjP()).optional()
});
/**
 * Combined schema for multiple-selection enumeration
 */
const MultiSelectEnumSchemaSchema = external/* union */.KCZ([UntitledMultiSelectEnumSchemaSchema, TitledMultiSelectEnumSchemaSchema]);
/**
 * Primitive schema definition for enum fields.
 */
const EnumSchemaSchema = external/* union */.KCZ([LegacyTitledEnumSchemaSchema, SingleSelectEnumSchemaSchema, MultiSelectEnumSchemaSchema]);
/**
 * Union of all primitive schema definitions.
 */
const PrimitiveSchemaDefinitionSchema = external/* union */.KCZ([EnumSchemaSchema, BooleanSchemaSchema, StringSchemaSchema, NumberSchemaSchema]);
/**
 * Parameters for an `elicitation/create` request for form-based elicitation.
 */
const ElicitRequestFormParamsSchema = TaskAugmentedRequestParamsSchema.extend({
    /**
     * The elicitation mode.
     *
     * Optional for backward compatibility. Clients MUST treat missing mode as "form".
     */
    mode: external/* literal */.euz('form').optional(),
    /**
     * The message to present to the user describing what information is being requested.
     */
    message: external/* string */.YjP(),
    /**
     * A restricted subset of JSON Schema.
     * Only top-level properties are allowed, without nesting.
     */
    requestedSchema: external/* object */.Ikc({
        type: external/* literal */.euz('object'),
        properties: external/* record */.g1P(external/* string */.YjP(), PrimitiveSchemaDefinitionSchema),
        required: external/* array */.YOg(external/* string */.YjP()).optional()
    })
});
/**
 * Parameters for an `elicitation/create` request for URL-based elicitation.
 */
const ElicitRequestURLParamsSchema = TaskAugmentedRequestParamsSchema.extend({
    /**
     * The elicitation mode.
     */
    mode: external/* literal */.euz('url'),
    /**
     * The message to present to the user explaining why the interaction is needed.
     */
    message: external/* string */.YjP(),
    /**
     * The ID of the elicitation, which must be unique within the context of the server.
     * The client MUST treat this ID as an opaque value.
     */
    elicitationId: external/* string */.YjP(),
    /**
     * The URL that the user should navigate to.
     */
    url: external/* string */.YjP().url()
});
/**
 * The parameters for a request to elicit additional information from the user via the client.
 */
const ElicitRequestParamsSchema = external/* union */.KCZ([ElicitRequestFormParamsSchema, ElicitRequestURLParamsSchema]);
/**
 * A request from the server to elicit user input via the client.
 * The client should present the message and form fields to the user (form mode)
 * or navigate to a URL (URL mode).
 */
const ElicitRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('elicitation/create'),
    params: ElicitRequestParamsSchema
});
/**
 * Parameters for a `notifications/elicitation/complete` notification.
 *
 * @category notifications/elicitation/complete
 */
const ElicitationCompleteNotificationParamsSchema = NotificationsParamsSchema.extend({
    /**
     * The ID of the elicitation that completed.
     */
    elicitationId: external/* string */.YjP()
});
/**
 * A notification from the server to the client, informing it of a completion of an out-of-band elicitation request.
 *
 * @category notifications/elicitation/complete
 */
const ElicitationCompleteNotificationSchema = NotificationSchema.extend({
    method: external/* literal */.euz('notifications/elicitation/complete'),
    params: ElicitationCompleteNotificationParamsSchema
});
/**
 * The client's response to an elicitation/create request from the server.
 */
const ElicitResultSchema = ResultSchema.extend({
    /**
     * The user action in response to the elicitation.
     * - "accept": User submitted the form/confirmed the action
     * - "decline": User explicitly decline the action
     * - "cancel": User dismissed without making an explicit choice
     */
    action: external/* enum */.k5n(['accept', 'decline', 'cancel']),
    /**
     * The submitted form data, only present when action is "accept".
     * Contains values matching the requested schema.
     * Per MCP spec, content is "typically omitted" for decline/cancel actions.
     * We normalize null to undefined for leniency while maintaining type compatibility.
     */
    content: external/* preprocess */.vkY(val => (val === null ? undefined : val), external/* record */.g1P(external/* string */.YjP(), external/* union */.KCZ([external/* string */.YjP(), external/* number */.aig(), external/* boolean */.zMY(), external/* array */.YOg(external/* string */.YjP())])).optional())
});
/* Autocomplete */
/**
 * A reference to a resource or resource template definition.
 */
const ResourceTemplateReferenceSchema = external/* object */.Ikc({
    type: external/* literal */.euz('ref/resource'),
    /**
     * The URI or URI template of the resource.
     */
    uri: external/* string */.YjP()
});
/**
 * @deprecated Use ResourceTemplateReferenceSchema instead
 */
const ResourceReferenceSchema = (/* unused pure expression or super */ null && (ResourceTemplateReferenceSchema));
/**
 * Identifies a prompt.
 */
const PromptReferenceSchema = external/* object */.Ikc({
    type: external/* literal */.euz('ref/prompt'),
    /**
     * The name of the prompt or prompt template
     */
    name: external/* string */.YjP()
});
/**
 * Parameters for a `completion/complete` request.
 */
const CompleteRequestParamsSchema = BaseRequestParamsSchema.extend({
    ref: external/* union */.KCZ([PromptReferenceSchema, ResourceTemplateReferenceSchema]),
    /**
     * The argument's information
     */
    argument: external/* object */.Ikc({
        /**
         * The name of the argument
         */
        name: external/* string */.YjP(),
        /**
         * The value of the argument to use for completion matching.
         */
        value: external/* string */.YjP()
    }),
    context: external/* object */.Ikc({
        /**
         * Previously-resolved variables in a URI template or prompt.
         */
        arguments: external/* record */.g1P(external/* string */.YjP(), external/* string */.YjP()).optional()
    })
        .optional()
});
/**
 * A request from the client to the server, to ask for completion options.
 */
const CompleteRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('completion/complete'),
    params: CompleteRequestParamsSchema
});
function assertCompleteRequestPrompt(request) {
    if (request.params.ref.type !== 'ref/prompt') {
        throw new TypeError(`Expected CompleteRequestPrompt, but got ${request.params.ref.type}`);
    }
    void request;
}
function assertCompleteRequestResourceTemplate(request) {
    if (request.params.ref.type !== 'ref/resource') {
        throw new TypeError(`Expected CompleteRequestResourceTemplate, but got ${request.params.ref.type}`);
    }
    void request;
}
/**
 * The server's response to a completion/complete request
 */
const CompleteResultSchema = ResultSchema.extend({
    completion: external/* looseObject */._H3({
        /**
         * An array of completion values. Must not exceed 100 items.
         */
        values: external/* array */.YOg(external/* string */.YjP()).max(100),
        /**
         * The total number of completion options available. This can exceed the number of values actually sent in the response.
         */
        total: external/* optional */.lqM(external/* number */.aig().int()),
        /**
         * Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.
         */
        hasMore: external/* optional */.lqM(external/* boolean */.zMY())
    })
});
/* Roots */
/**
 * Represents a root directory or file that the server can operate on.
 */
const RootSchema = external/* object */.Ikc({
    /**
     * The URI identifying the root. This *must* start with file:// for now.
     */
    uri: external/* string */.YjP().startsWith('file://'),
    /**
     * An optional name for the root.
     */
    name: external/* string */.YjP().optional(),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: external/* record */.g1P(external/* string */.YjP(), external/* unknown */.L5J()).optional()
});
/**
 * Sent from the server to request a list of root URIs from the client.
 */
const ListRootsRequestSchema = RequestSchema.extend({
    method: external/* literal */.euz('roots/list'),
    params: BaseRequestParamsSchema.optional()
});
/**
 * The client's response to a roots/list request from the server.
 */
const ListRootsResultSchema = ResultSchema.extend({
    roots: external/* array */.YOg(RootSchema)
});
/**
 * A notification from the client to the server, informing it that the list of roots has changed.
 */
const RootsListChangedNotificationSchema = NotificationSchema.extend({
    method: external/* literal */.euz('notifications/roots/list_changed'),
    params: NotificationsParamsSchema.optional()
});
/* Client messages */
const ClientRequestSchema = external/* union */.KCZ([
    PingRequestSchema,
    InitializeRequestSchema,
    CompleteRequestSchema,
    SetLevelRequestSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListResourceTemplatesRequestSchema,
    ReadResourceRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
    CallToolRequestSchema,
    ListToolsRequestSchema,
    GetTaskRequestSchema,
    GetTaskPayloadRequestSchema,
    ListTasksRequestSchema,
    CancelTaskRequestSchema
]);
const ClientNotificationSchema = external/* union */.KCZ([
    CancelledNotificationSchema,
    ProgressNotificationSchema,
    InitializedNotificationSchema,
    RootsListChangedNotificationSchema,
    TaskStatusNotificationSchema
]);
const ClientResultSchema = external/* union */.KCZ([
    EmptyResultSchema,
    CreateMessageResultSchema,
    CreateMessageResultWithToolsSchema,
    ElicitResultSchema,
    ListRootsResultSchema,
    GetTaskResultSchema,
    ListTasksResultSchema,
    CreateTaskResultSchema
]);
/* Server messages */
const ServerRequestSchema = external/* union */.KCZ([
    PingRequestSchema,
    CreateMessageRequestSchema,
    ElicitRequestSchema,
    ListRootsRequestSchema,
    GetTaskRequestSchema,
    GetTaskPayloadRequestSchema,
    ListTasksRequestSchema,
    CancelTaskRequestSchema
]);
const ServerNotificationSchema = external/* union */.KCZ([
    CancelledNotificationSchema,
    ProgressNotificationSchema,
    LoggingMessageNotificationSchema,
    ResourceUpdatedNotificationSchema,
    ResourceListChangedNotificationSchema,
    ToolListChangedNotificationSchema,
    PromptListChangedNotificationSchema,
    TaskStatusNotificationSchema,
    ElicitationCompleteNotificationSchema
]);
const ServerResultSchema = external/* union */.KCZ([
    EmptyResultSchema,
    InitializeResultSchema,
    CompleteResultSchema,
    GetPromptResultSchema,
    ListPromptsResultSchema,
    ListResourcesResultSchema,
    ListResourceTemplatesResultSchema,
    ReadResourceResultSchema,
    CallToolResultSchema,
    ListToolsResultSchema,
    GetTaskResultSchema,
    ListTasksResultSchema,
    CreateTaskResultSchema
]);
class McpError extends Error {
    constructor(code, message, data) {
        super(`MCP error ${code}: ${message}`);
        this.code = code;
        this.data = data;
        this.name = 'McpError';
    }
    /**
     * Factory method to create the appropriate error type based on the error code and data
     */
    static fromError(code, message, data) {
        // Check for specific error types
        if (code === ErrorCode.UrlElicitationRequired && data) {
            const errorData = data;
            if (errorData.elicitations) {
                return new UrlElicitationRequiredError(errorData.elicitations, message);
            }
        }
        // Default to generic McpError
        return new McpError(code, message, data);
    }
}
/**
 * Specialized error type when a tool requires a URL mode elicitation.
 * This makes it nicer for the client to handle since there is specific data to work with instead of just a code to check against.
 */
class UrlElicitationRequiredError extends McpError {
    constructor(elicitations, message = `URL elicitation${elicitations.length > 1 ? 's' : ''} required`) {
        super(ErrorCode.UrlElicitationRequired, message, {
            elicitations: elicitations
        });
    }
    get elicitations() {
        return this.data?.elicitations ?? [];
    }
}
//# sourceMappingURL=types.js.map

/***/ })

};

//# sourceMappingURL=305.index.js.map