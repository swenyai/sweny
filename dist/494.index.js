export const id = 494;
export const ids = [494];
export const modules = {

/***/ 13913:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.resolveHttpAuthSchemeConfig = exports.defaultSecretsManagerHttpAuthSchemeProvider = exports.defaultSecretsManagerHttpAuthSchemeParametersProvider = void 0;
const core_1 = __webpack_require__(39116);
const util_middleware_1 = __webpack_require__(54160);
const defaultSecretsManagerHttpAuthSchemeParametersProvider = async (config, context, input) => {
    return {
        operation: (0, util_middleware_1.getSmithyContext)(context).operation,
        region: await (0, util_middleware_1.normalizeProvider)(config.region)() || (() => {
            throw new Error("expected `region` to be configured for `aws.auth#sigv4`");
        })(),
    };
};
exports.defaultSecretsManagerHttpAuthSchemeParametersProvider = defaultSecretsManagerHttpAuthSchemeParametersProvider;
function createAwsAuthSigv4HttpAuthOption(authParameters) {
    return {
        schemeId: "aws.auth#sigv4",
        signingProperties: {
            name: "secretsmanager",
            region: authParameters.region,
        },
        propertiesExtractor: (config, context) => ({
            signingProperties: {
                config,
                context,
            },
        }),
    };
}
const defaultSecretsManagerHttpAuthSchemeProvider = (authParameters) => {
    const options = [];
    switch (authParameters.operation) {
        default: {
            options.push(createAwsAuthSigv4HttpAuthOption(authParameters));
        }
    }
    return options;
};
exports.defaultSecretsManagerHttpAuthSchemeProvider = defaultSecretsManagerHttpAuthSchemeProvider;
const resolveHttpAuthSchemeConfig = (config) => {
    const config_0 = (0, core_1.resolveAwsSdkSigV4Config)(config);
    return Object.assign(config_0, {
        authSchemePreference: (0, util_middleware_1.normalizeProvider)(config.authSchemePreference ?? []),
    });
};
exports.resolveHttpAuthSchemeConfig = resolveHttpAuthSchemeConfig;


/***/ }),

/***/ 14863:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.defaultEndpointResolver = void 0;
const util_endpoints_1 = __webpack_require__(94024);
const util_endpoints_2 = __webpack_require__(49622);
const ruleset_1 = __webpack_require__(27644);
const cache = new util_endpoints_2.EndpointCache({
    size: 50,
    params: ["Endpoint", "Region", "UseDualStack", "UseFIPS"],
});
const defaultEndpointResolver = (endpointParams, context = {}) => {
    return cache.get(endpointParams, () => (0, util_endpoints_2.resolveEndpoint)(ruleset_1.ruleSet, {
        endpointParams: endpointParams,
        logger: context.logger,
    }));
};
exports.defaultEndpointResolver = defaultEndpointResolver;
util_endpoints_2.customEndpointFunctions.aws = util_endpoints_1.awsEndpointFunctions;


/***/ }),

/***/ 27644:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ruleSet = void 0;
const y = "required", z = "fn", A = "argv", B = "ref", C = "properties", D = "headers";
const a = true, b = "isSet", c = "booleanEquals", d = "error", e = "endpoint", f = "tree", g = "PartitionResult", h = "stringEquals", i = { [y]: false, "type": "string" }, j = { [y]: true, "default": false, "type": "boolean" }, k = { [B]: "Endpoint" }, l = { [z]: c, [A]: [{ [B]: "UseFIPS" }, true] }, m = { [z]: c, [A]: [{ [B]: "UseDualStack" }, true] }, n = {}, o = { [z]: "getAttr", [A]: [{ [B]: g }, "supportsFIPS"] }, p = { [z]: c, [A]: [true, { [z]: "getAttr", [A]: [{ [B]: g }, "supportsDualStack"] }] }, q = { [z]: "getAttr", [A]: [{ [B]: g }, "name"] }, r = { "url": "https://secretsmanager-fips.{Region}.amazonaws.com", [C]: {}, [D]: {} }, s = { "url": "https://secretsmanager.{Region}.amazonaws.com", [C]: {}, [D]: {} }, t = [l], u = [m], v = [{ [B]: "Region" }], w = [{ [z]: h, [A]: ["aws", q] }], x = [{ [z]: h, [A]: ["aws-us-gov", q] }];
const _data = { version: "1.0", parameters: { Region: i, UseDualStack: j, UseFIPS: j, Endpoint: i }, rules: [{ conditions: [{ [z]: b, [A]: [k] }], rules: [{ conditions: t, error: "Invalid Configuration: FIPS and custom endpoint are not supported", type: d }, { conditions: u, error: "Invalid Configuration: Dualstack and custom endpoint are not supported", type: d }, { endpoint: { url: k, [C]: n, [D]: n }, type: e }], type: f }, { conditions: [{ [z]: b, [A]: v }], rules: [{ conditions: [{ [z]: "aws.partition", [A]: v, assign: g }], rules: [{ conditions: [l, m], rules: [{ conditions: [{ [z]: c, [A]: [a, o] }, p], rules: [{ conditions: w, endpoint: r, type: e }, { conditions: x, endpoint: r, type: e }, { endpoint: { url: "https://secretsmanager-fips.{Region}.{PartitionResult#dualStackDnsSuffix}", [C]: n, [D]: n }, type: e }], type: f }, { error: "FIPS and DualStack are enabled, but this partition does not support one or both", type: d }], type: f }, { conditions: t, rules: [{ conditions: [{ [z]: c, [A]: [o, a] }], rules: [{ endpoint: { url: "https://secretsmanager-fips.{Region}.{PartitionResult#dnsSuffix}", [C]: n, [D]: n }, type: e }], type: f }, { error: "FIPS is enabled but this partition does not support FIPS", type: d }], type: f }, { conditions: u, rules: [{ conditions: [p], rules: [{ conditions: w, endpoint: s, type: e }, { conditions: [{ [z]: h, [A]: ["aws-cn", q] }], endpoint: { url: "https://secretsmanager.{Region}.amazonaws.com.cn", [C]: n, [D]: n }, type: e }, { conditions: x, endpoint: s, type: e }, { endpoint: { url: "https://secretsmanager.{Region}.{PartitionResult#dualStackDnsSuffix}", [C]: n, [D]: n }, type: e }], type: f }, { error: "DualStack is enabled but this partition does not support DualStack", type: d }], type: f }, { endpoint: { url: "https://secretsmanager.{Region}.{PartitionResult#dnsSuffix}", [C]: n, [D]: n }, type: e }], type: f }], type: f }, { error: "Invalid Configuration: Missing Region", type: d }] };
exports.ruleSet = _data;


/***/ }),

/***/ 75494:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var middlewareHostHeader = __webpack_require__(54746);
var middlewareLogger = __webpack_require__(10438);
var middlewareRecursionDetection = __webpack_require__(52588);
var middlewareUserAgent = __webpack_require__(3979);
var configResolver = __webpack_require__(93768);
var core = __webpack_require__(75086);
var schema = __webpack_require__(15982);
var middlewareContentLength = __webpack_require__(82352);
var middlewareEndpoint = __webpack_require__(10775);
var middlewareRetry = __webpack_require__(46318);
var smithyClient = __webpack_require__(58015);
var httpAuthSchemeProvider = __webpack_require__(13913);
var runtimeConfig = __webpack_require__(6312);
var regionConfigResolver = __webpack_require__(52627);
var protocolHttp = __webpack_require__(29752);
var schemas_0 = __webpack_require__(88790);
var errors = __webpack_require__(15994);
var SecretsManagerServiceException = __webpack_require__(14417);

const resolveClientEndpointParameters = (options) => {
    return Object.assign(options, {
        useDualstackEndpoint: options.useDualstackEndpoint ?? false,
        useFipsEndpoint: options.useFipsEndpoint ?? false,
        defaultSigningName: "secretsmanager",
    });
};
const commonParams = {
    UseFIPS: { type: "builtInParams", name: "useFipsEndpoint" },
    Endpoint: { type: "builtInParams", name: "endpoint" },
    Region: { type: "builtInParams", name: "region" },
    UseDualStack: { type: "builtInParams", name: "useDualstackEndpoint" },
};

const getHttpAuthExtensionConfiguration = (runtimeConfig) => {
    const _httpAuthSchemes = runtimeConfig.httpAuthSchemes;
    let _httpAuthSchemeProvider = runtimeConfig.httpAuthSchemeProvider;
    let _credentials = runtimeConfig.credentials;
    return {
        setHttpAuthScheme(httpAuthScheme) {
            const index = _httpAuthSchemes.findIndex((scheme) => scheme.schemeId === httpAuthScheme.schemeId);
            if (index === -1) {
                _httpAuthSchemes.push(httpAuthScheme);
            }
            else {
                _httpAuthSchemes.splice(index, 1, httpAuthScheme);
            }
        },
        httpAuthSchemes() {
            return _httpAuthSchemes;
        },
        setHttpAuthSchemeProvider(httpAuthSchemeProvider) {
            _httpAuthSchemeProvider = httpAuthSchemeProvider;
        },
        httpAuthSchemeProvider() {
            return _httpAuthSchemeProvider;
        },
        setCredentials(credentials) {
            _credentials = credentials;
        },
        credentials() {
            return _credentials;
        },
    };
};
const resolveHttpAuthRuntimeConfig = (config) => {
    return {
        httpAuthSchemes: config.httpAuthSchemes(),
        httpAuthSchemeProvider: config.httpAuthSchemeProvider(),
        credentials: config.credentials(),
    };
};

const resolveRuntimeExtensions = (runtimeConfig, extensions) => {
    const extensionConfiguration = Object.assign(regionConfigResolver.getAwsRegionExtensionConfiguration(runtimeConfig), smithyClient.getDefaultExtensionConfiguration(runtimeConfig), protocolHttp.getHttpHandlerExtensionConfiguration(runtimeConfig), getHttpAuthExtensionConfiguration(runtimeConfig));
    extensions.forEach((extension) => extension.configure(extensionConfiguration));
    return Object.assign(runtimeConfig, regionConfigResolver.resolveAwsRegionExtensionConfiguration(extensionConfiguration), smithyClient.resolveDefaultRuntimeConfig(extensionConfiguration), protocolHttp.resolveHttpHandlerRuntimeConfig(extensionConfiguration), resolveHttpAuthRuntimeConfig(extensionConfiguration));
};

class SecretsManagerClient extends smithyClient.Client {
    config;
    constructor(...[configuration]) {
        const _config_0 = runtimeConfig.getRuntimeConfig(configuration || {});
        super(_config_0);
        this.initConfig = _config_0;
        const _config_1 = resolveClientEndpointParameters(_config_0);
        const _config_2 = middlewareUserAgent.resolveUserAgentConfig(_config_1);
        const _config_3 = middlewareRetry.resolveRetryConfig(_config_2);
        const _config_4 = configResolver.resolveRegionConfig(_config_3);
        const _config_5 = middlewareHostHeader.resolveHostHeaderConfig(_config_4);
        const _config_6 = middlewareEndpoint.resolveEndpointConfig(_config_5);
        const _config_7 = httpAuthSchemeProvider.resolveHttpAuthSchemeConfig(_config_6);
        const _config_8 = resolveRuntimeExtensions(_config_7, configuration?.extensions || []);
        this.config = _config_8;
        this.middlewareStack.use(schema.getSchemaSerdePlugin(this.config));
        this.middlewareStack.use(middlewareUserAgent.getUserAgentPlugin(this.config));
        this.middlewareStack.use(middlewareRetry.getRetryPlugin(this.config));
        this.middlewareStack.use(middlewareContentLength.getContentLengthPlugin(this.config));
        this.middlewareStack.use(middlewareHostHeader.getHostHeaderPlugin(this.config));
        this.middlewareStack.use(middlewareLogger.getLoggerPlugin(this.config));
        this.middlewareStack.use(middlewareRecursionDetection.getRecursionDetectionPlugin(this.config));
        this.middlewareStack.use(core.getHttpAuthSchemeEndpointRuleSetPlugin(this.config, {
            httpAuthSchemeParametersProvider: httpAuthSchemeProvider.defaultSecretsManagerHttpAuthSchemeParametersProvider,
            identityProviderConfigProvider: async (config) => new core.DefaultIdentityProviderConfig({
                "aws.auth#sigv4": config.credentials,
            }),
        }));
        this.middlewareStack.use(core.getHttpSigningPlugin(this.config));
    }
    destroy() {
        super.destroy();
    }
}

class BatchGetSecretValueCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "BatchGetSecretValue", {})
    .n("SecretsManagerClient", "BatchGetSecretValueCommand")
    .sc(schemas_0.BatchGetSecretValue$)
    .build() {
}

class CancelRotateSecretCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "CancelRotateSecret", {})
    .n("SecretsManagerClient", "CancelRotateSecretCommand")
    .sc(schemas_0.CancelRotateSecret$)
    .build() {
}

class CreateSecretCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "CreateSecret", {})
    .n("SecretsManagerClient", "CreateSecretCommand")
    .sc(schemas_0.CreateSecret$)
    .build() {
}

class DeleteResourcePolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "DeleteResourcePolicy", {})
    .n("SecretsManagerClient", "DeleteResourcePolicyCommand")
    .sc(schemas_0.DeleteResourcePolicy$)
    .build() {
}

class DeleteSecretCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "DeleteSecret", {})
    .n("SecretsManagerClient", "DeleteSecretCommand")
    .sc(schemas_0.DeleteSecret$)
    .build() {
}

class DescribeSecretCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "DescribeSecret", {})
    .n("SecretsManagerClient", "DescribeSecretCommand")
    .sc(schemas_0.DescribeSecret$)
    .build() {
}

class GetRandomPasswordCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "GetRandomPassword", {})
    .n("SecretsManagerClient", "GetRandomPasswordCommand")
    .sc(schemas_0.GetRandomPassword$)
    .build() {
}

class GetResourcePolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "GetResourcePolicy", {})
    .n("SecretsManagerClient", "GetResourcePolicyCommand")
    .sc(schemas_0.GetResourcePolicy$)
    .build() {
}

class GetSecretValueCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "GetSecretValue", {})
    .n("SecretsManagerClient", "GetSecretValueCommand")
    .sc(schemas_0.GetSecretValue$)
    .build() {
}

class ListSecretsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "ListSecrets", {})
    .n("SecretsManagerClient", "ListSecretsCommand")
    .sc(schemas_0.ListSecrets$)
    .build() {
}

class ListSecretVersionIdsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "ListSecretVersionIds", {})
    .n("SecretsManagerClient", "ListSecretVersionIdsCommand")
    .sc(schemas_0.ListSecretVersionIds$)
    .build() {
}

class PutResourcePolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "PutResourcePolicy", {})
    .n("SecretsManagerClient", "PutResourcePolicyCommand")
    .sc(schemas_0.PutResourcePolicy$)
    .build() {
}

class PutSecretValueCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "PutSecretValue", {})
    .n("SecretsManagerClient", "PutSecretValueCommand")
    .sc(schemas_0.PutSecretValue$)
    .build() {
}

class RemoveRegionsFromReplicationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "RemoveRegionsFromReplication", {})
    .n("SecretsManagerClient", "RemoveRegionsFromReplicationCommand")
    .sc(schemas_0.RemoveRegionsFromReplication$)
    .build() {
}

class ReplicateSecretToRegionsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "ReplicateSecretToRegions", {})
    .n("SecretsManagerClient", "ReplicateSecretToRegionsCommand")
    .sc(schemas_0.ReplicateSecretToRegions$)
    .build() {
}

class RestoreSecretCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "RestoreSecret", {})
    .n("SecretsManagerClient", "RestoreSecretCommand")
    .sc(schemas_0.RestoreSecret$)
    .build() {
}

class RotateSecretCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "RotateSecret", {})
    .n("SecretsManagerClient", "RotateSecretCommand")
    .sc(schemas_0.RotateSecret$)
    .build() {
}

class StopReplicationToReplicaCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "StopReplicationToReplica", {})
    .n("SecretsManagerClient", "StopReplicationToReplicaCommand")
    .sc(schemas_0.StopReplicationToReplica$)
    .build() {
}

class TagResourceCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "TagResource", {})
    .n("SecretsManagerClient", "TagResourceCommand")
    .sc(schemas_0.TagResource$)
    .build() {
}

class UntagResourceCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "UntagResource", {})
    .n("SecretsManagerClient", "UntagResourceCommand")
    .sc(schemas_0.UntagResource$)
    .build() {
}

class UpdateSecretCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "UpdateSecret", {})
    .n("SecretsManagerClient", "UpdateSecretCommand")
    .sc(schemas_0.UpdateSecret$)
    .build() {
}

class UpdateSecretVersionStageCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "UpdateSecretVersionStage", {})
    .n("SecretsManagerClient", "UpdateSecretVersionStageCommand")
    .sc(schemas_0.UpdateSecretVersionStage$)
    .build() {
}

class ValidateResourcePolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("secretsmanager", "ValidateResourcePolicy", {})
    .n("SecretsManagerClient", "ValidateResourcePolicyCommand")
    .sc(schemas_0.ValidateResourcePolicy$)
    .build() {
}

const paginateBatchGetSecretValue = core.createPaginator(SecretsManagerClient, BatchGetSecretValueCommand, "NextToken", "NextToken", "MaxResults");

const paginateListSecrets = core.createPaginator(SecretsManagerClient, ListSecretsCommand, "NextToken", "NextToken", "MaxResults");

const paginateListSecretVersionIds = core.createPaginator(SecretsManagerClient, ListSecretVersionIdsCommand, "NextToken", "NextToken", "MaxResults");

const commands = {
    BatchGetSecretValueCommand,
    CancelRotateSecretCommand,
    CreateSecretCommand,
    DeleteResourcePolicyCommand,
    DeleteSecretCommand,
    DescribeSecretCommand,
    GetRandomPasswordCommand,
    GetResourcePolicyCommand,
    GetSecretValueCommand,
    ListSecretsCommand,
    ListSecretVersionIdsCommand,
    PutResourcePolicyCommand,
    PutSecretValueCommand,
    RemoveRegionsFromReplicationCommand,
    ReplicateSecretToRegionsCommand,
    RestoreSecretCommand,
    RotateSecretCommand,
    StopReplicationToReplicaCommand,
    TagResourceCommand,
    UntagResourceCommand,
    UpdateSecretCommand,
    UpdateSecretVersionStageCommand,
    ValidateResourcePolicyCommand,
};
const paginators = {
    paginateBatchGetSecretValue,
    paginateListSecrets,
    paginateListSecretVersionIds,
};
class SecretsManager extends SecretsManagerClient {
}
smithyClient.createAggregatedClient(commands, SecretsManager, { paginators });

const FilterNameStringType = {
    all: "all",
    description: "description",
    name: "name",
    owning_service: "owning-service",
    primary_region: "primary-region",
    tag_key: "tag-key",
    tag_value: "tag-value",
};
const StatusType = {
    Failed: "Failed",
    InProgress: "InProgress",
    InSync: "InSync",
};
const SortByType = {
    created_date: "created-date",
    last_accessed_date: "last-accessed-date",
    last_changed_date: "last-changed-date",
    name: "name",
};
const SortOrderType = {
    asc: "asc",
    desc: "desc",
};

exports.$Command = smithyClient.Command;
exports.__Client = smithyClient.Client;
exports.SecretsManagerServiceException = SecretsManagerServiceException.SecretsManagerServiceException;
exports.BatchGetSecretValueCommand = BatchGetSecretValueCommand;
exports.CancelRotateSecretCommand = CancelRotateSecretCommand;
exports.CreateSecretCommand = CreateSecretCommand;
exports.DeleteResourcePolicyCommand = DeleteResourcePolicyCommand;
exports.DeleteSecretCommand = DeleteSecretCommand;
exports.DescribeSecretCommand = DescribeSecretCommand;
exports.FilterNameStringType = FilterNameStringType;
exports.GetRandomPasswordCommand = GetRandomPasswordCommand;
exports.GetResourcePolicyCommand = GetResourcePolicyCommand;
exports.GetSecretValueCommand = GetSecretValueCommand;
exports.ListSecretVersionIdsCommand = ListSecretVersionIdsCommand;
exports.ListSecretsCommand = ListSecretsCommand;
exports.PutResourcePolicyCommand = PutResourcePolicyCommand;
exports.PutSecretValueCommand = PutSecretValueCommand;
exports.RemoveRegionsFromReplicationCommand = RemoveRegionsFromReplicationCommand;
exports.ReplicateSecretToRegionsCommand = ReplicateSecretToRegionsCommand;
exports.RestoreSecretCommand = RestoreSecretCommand;
exports.RotateSecretCommand = RotateSecretCommand;
exports.SecretsManager = SecretsManager;
exports.SecretsManagerClient = SecretsManagerClient;
exports.SortByType = SortByType;
exports.SortOrderType = SortOrderType;
exports.StatusType = StatusType;
exports.StopReplicationToReplicaCommand = StopReplicationToReplicaCommand;
exports.TagResourceCommand = TagResourceCommand;
exports.UntagResourceCommand = UntagResourceCommand;
exports.UpdateSecretCommand = UpdateSecretCommand;
exports.UpdateSecretVersionStageCommand = UpdateSecretVersionStageCommand;
exports.ValidateResourcePolicyCommand = ValidateResourcePolicyCommand;
exports.paginateBatchGetSecretValue = paginateBatchGetSecretValue;
exports.paginateListSecretVersionIds = paginateListSecretVersionIds;
exports.paginateListSecrets = paginateListSecrets;
Object.prototype.hasOwnProperty.call(schemas_0, '__proto__') &&
    !Object.prototype.hasOwnProperty.call(exports, '__proto__') &&
    Object.defineProperty(exports, '__proto__', {
        enumerable: true,
        value: schemas_0['__proto__']
    });

Object.keys(schemas_0).forEach(function (k) {
    if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) exports[k] = schemas_0[k];
});
Object.prototype.hasOwnProperty.call(errors, '__proto__') &&
    !Object.prototype.hasOwnProperty.call(exports, '__proto__') &&
    Object.defineProperty(exports, '__proto__', {
        enumerable: true,
        value: errors['__proto__']
    });

Object.keys(errors).forEach(function (k) {
    if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) exports[k] = errors[k];
});


/***/ }),

/***/ 14417:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.SecretsManagerServiceException = exports.__ServiceException = void 0;
const smithy_client_1 = __webpack_require__(58015);
Object.defineProperty(exports, "__ServiceException", ({ enumerable: true, get: function () { return smithy_client_1.ServiceException; } }));
class SecretsManagerServiceException extends smithy_client_1.ServiceException {
    constructor(options) {
        super(options);
        Object.setPrototypeOf(this, SecretsManagerServiceException.prototype);
    }
}
exports.SecretsManagerServiceException = SecretsManagerServiceException;


/***/ }),

/***/ 15994:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.PublicPolicyException = exports.ResourceExistsException = exports.PreconditionNotMetException = exports.MalformedPolicyDocumentException = exports.LimitExceededException = exports.EncryptionFailure = exports.ResourceNotFoundException = exports.InvalidRequestException = exports.InvalidParameterException = exports.InvalidNextTokenException = exports.InternalServiceError = exports.DecryptionFailure = void 0;
const SecretsManagerServiceException_1 = __webpack_require__(14417);
class DecryptionFailure extends SecretsManagerServiceException_1.SecretsManagerServiceException {
    name = "DecryptionFailure";
    $fault = "client";
    Message;
    constructor(opts) {
        super({
            name: "DecryptionFailure",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, DecryptionFailure.prototype);
        this.Message = opts.Message;
    }
}
exports.DecryptionFailure = DecryptionFailure;
class InternalServiceError extends SecretsManagerServiceException_1.SecretsManagerServiceException {
    name = "InternalServiceError";
    $fault = "server";
    Message;
    constructor(opts) {
        super({
            name: "InternalServiceError",
            $fault: "server",
            ...opts,
        });
        Object.setPrototypeOf(this, InternalServiceError.prototype);
        this.Message = opts.Message;
    }
}
exports.InternalServiceError = InternalServiceError;
class InvalidNextTokenException extends SecretsManagerServiceException_1.SecretsManagerServiceException {
    name = "InvalidNextTokenException";
    $fault = "client";
    Message;
    constructor(opts) {
        super({
            name: "InvalidNextTokenException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InvalidNextTokenException.prototype);
        this.Message = opts.Message;
    }
}
exports.InvalidNextTokenException = InvalidNextTokenException;
class InvalidParameterException extends SecretsManagerServiceException_1.SecretsManagerServiceException {
    name = "InvalidParameterException";
    $fault = "client";
    Message;
    constructor(opts) {
        super({
            name: "InvalidParameterException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InvalidParameterException.prototype);
        this.Message = opts.Message;
    }
}
exports.InvalidParameterException = InvalidParameterException;
class InvalidRequestException extends SecretsManagerServiceException_1.SecretsManagerServiceException {
    name = "InvalidRequestException";
    $fault = "client";
    Message;
    constructor(opts) {
        super({
            name: "InvalidRequestException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InvalidRequestException.prototype);
        this.Message = opts.Message;
    }
}
exports.InvalidRequestException = InvalidRequestException;
class ResourceNotFoundException extends SecretsManagerServiceException_1.SecretsManagerServiceException {
    name = "ResourceNotFoundException";
    $fault = "client";
    Message;
    constructor(opts) {
        super({
            name: "ResourceNotFoundException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ResourceNotFoundException.prototype);
        this.Message = opts.Message;
    }
}
exports.ResourceNotFoundException = ResourceNotFoundException;
class EncryptionFailure extends SecretsManagerServiceException_1.SecretsManagerServiceException {
    name = "EncryptionFailure";
    $fault = "client";
    Message;
    constructor(opts) {
        super({
            name: "EncryptionFailure",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, EncryptionFailure.prototype);
        this.Message = opts.Message;
    }
}
exports.EncryptionFailure = EncryptionFailure;
class LimitExceededException extends SecretsManagerServiceException_1.SecretsManagerServiceException {
    name = "LimitExceededException";
    $fault = "client";
    Message;
    constructor(opts) {
        super({
            name: "LimitExceededException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, LimitExceededException.prototype);
        this.Message = opts.Message;
    }
}
exports.LimitExceededException = LimitExceededException;
class MalformedPolicyDocumentException extends SecretsManagerServiceException_1.SecretsManagerServiceException {
    name = "MalformedPolicyDocumentException";
    $fault = "client";
    Message;
    constructor(opts) {
        super({
            name: "MalformedPolicyDocumentException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, MalformedPolicyDocumentException.prototype);
        this.Message = opts.Message;
    }
}
exports.MalformedPolicyDocumentException = MalformedPolicyDocumentException;
class PreconditionNotMetException extends SecretsManagerServiceException_1.SecretsManagerServiceException {
    name = "PreconditionNotMetException";
    $fault = "client";
    Message;
    constructor(opts) {
        super({
            name: "PreconditionNotMetException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, PreconditionNotMetException.prototype);
        this.Message = opts.Message;
    }
}
exports.PreconditionNotMetException = PreconditionNotMetException;
class ResourceExistsException extends SecretsManagerServiceException_1.SecretsManagerServiceException {
    name = "ResourceExistsException";
    $fault = "client";
    Message;
    constructor(opts) {
        super({
            name: "ResourceExistsException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ResourceExistsException.prototype);
        this.Message = opts.Message;
    }
}
exports.ResourceExistsException = ResourceExistsException;
class PublicPolicyException extends SecretsManagerServiceException_1.SecretsManagerServiceException {
    name = "PublicPolicyException";
    $fault = "client";
    Message;
    constructor(opts) {
        super({
            name: "PublicPolicyException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, PublicPolicyException.prototype);
        this.Message = opts.Message;
    }
}
exports.PublicPolicyException = PublicPolicyException;


/***/ }),

/***/ 6312:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getRuntimeConfig = void 0;
const tslib_1 = __webpack_require__(94176);
const package_json_1 = tslib_1.__importDefault(__webpack_require__(59361));
const core_1 = __webpack_require__(39116);
const credential_provider_node_1 = __webpack_require__(97777);
const util_user_agent_node_1 = __webpack_require__(16388);
const config_resolver_1 = __webpack_require__(93768);
const hash_node_1 = __webpack_require__(51296);
const middleware_retry_1 = __webpack_require__(46318);
const node_config_provider_1 = __webpack_require__(71172);
const node_http_handler_1 = __webpack_require__(18771);
const smithy_client_1 = __webpack_require__(58015);
const util_body_length_node_1 = __webpack_require__(68194);
const util_defaults_mode_node_1 = __webpack_require__(17215);
const util_retry_1 = __webpack_require__(54506);
const runtimeConfig_shared_1 = __webpack_require__(11881);
const getRuntimeConfig = (config) => {
    (0, smithy_client_1.emitWarningIfUnsupportedVersion)(process.version);
    const defaultsMode = (0, util_defaults_mode_node_1.resolveDefaultsModeConfig)(config);
    const defaultConfigProvider = () => defaultsMode().then(smithy_client_1.loadConfigsForDefaultMode);
    const clientSharedValues = (0, runtimeConfig_shared_1.getRuntimeConfig)(config);
    (0, core_1.emitWarningIfUnsupportedVersion)(process.version);
    const loaderConfig = {
        profile: config?.profile,
        logger: clientSharedValues.logger,
    };
    return {
        ...clientSharedValues,
        ...config,
        runtime: "node",
        defaultsMode,
        authSchemePreference: config?.authSchemePreference ?? (0, node_config_provider_1.loadConfig)(core_1.NODE_AUTH_SCHEME_PREFERENCE_OPTIONS, loaderConfig),
        bodyLengthChecker: config?.bodyLengthChecker ?? util_body_length_node_1.calculateBodyLength,
        credentialDefaultProvider: config?.credentialDefaultProvider ?? credential_provider_node_1.defaultProvider,
        defaultUserAgentProvider: config?.defaultUserAgentProvider ?? (0, util_user_agent_node_1.createDefaultUserAgentProvider)({ serviceId: clientSharedValues.serviceId, clientVersion: package_json_1.default.version }),
        maxAttempts: config?.maxAttempts ?? (0, node_config_provider_1.loadConfig)(middleware_retry_1.NODE_MAX_ATTEMPT_CONFIG_OPTIONS, config),
        region: config?.region ?? (0, node_config_provider_1.loadConfig)(config_resolver_1.NODE_REGION_CONFIG_OPTIONS, { ...config_resolver_1.NODE_REGION_CONFIG_FILE_OPTIONS, ...loaderConfig }),
        requestHandler: node_http_handler_1.NodeHttpHandler.create(config?.requestHandler ?? defaultConfigProvider),
        retryMode: config?.retryMode ??
            (0, node_config_provider_1.loadConfig)({
                ...middleware_retry_1.NODE_RETRY_MODE_CONFIG_OPTIONS,
                default: async () => (await defaultConfigProvider()).retryMode || util_retry_1.DEFAULT_RETRY_MODE,
            }, config),
        sha256: config?.sha256 ?? hash_node_1.Hash.bind(null, "sha256"),
        streamCollector: config?.streamCollector ?? node_http_handler_1.streamCollector,
        useDualstackEndpoint: config?.useDualstackEndpoint ?? (0, node_config_provider_1.loadConfig)(config_resolver_1.NODE_USE_DUALSTACK_ENDPOINT_CONFIG_OPTIONS, loaderConfig),
        useFipsEndpoint: config?.useFipsEndpoint ?? (0, node_config_provider_1.loadConfig)(config_resolver_1.NODE_USE_FIPS_ENDPOINT_CONFIG_OPTIONS, loaderConfig),
        userAgentAppId: config?.userAgentAppId ?? (0, node_config_provider_1.loadConfig)(util_user_agent_node_1.NODE_APP_ID_CONFIG_OPTIONS, loaderConfig),
    };
};
exports.getRuntimeConfig = getRuntimeConfig;


/***/ }),

/***/ 11881:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getRuntimeConfig = void 0;
const core_1 = __webpack_require__(39116);
const protocols_1 = __webpack_require__(23628);
const smithy_client_1 = __webpack_require__(58015);
const url_parser_1 = __webpack_require__(7834);
const util_base64_1 = __webpack_require__(77245);
const util_utf8_1 = __webpack_require__(76005);
const httpAuthSchemeProvider_1 = __webpack_require__(13913);
const endpointResolver_1 = __webpack_require__(14863);
const schemas_0_1 = __webpack_require__(88790);
const getRuntimeConfig = (config) => {
    return {
        apiVersion: "2017-10-17",
        base64Decoder: config?.base64Decoder ?? util_base64_1.fromBase64,
        base64Encoder: config?.base64Encoder ?? util_base64_1.toBase64,
        disableHostPrefix: config?.disableHostPrefix ?? false,
        endpointProvider: config?.endpointProvider ?? endpointResolver_1.defaultEndpointResolver,
        extensions: config?.extensions ?? [],
        httpAuthSchemeProvider: config?.httpAuthSchemeProvider ?? httpAuthSchemeProvider_1.defaultSecretsManagerHttpAuthSchemeProvider,
        httpAuthSchemes: config?.httpAuthSchemes ?? [
            {
                schemeId: "aws.auth#sigv4",
                identityProvider: (ipc) => ipc.getIdentityProvider("aws.auth#sigv4"),
                signer: new core_1.AwsSdkSigV4Signer(),
            },
        ],
        logger: config?.logger ?? new smithy_client_1.NoOpLogger(),
        protocol: config?.protocol ?? protocols_1.AwsJson1_1Protocol,
        protocolSettings: config?.protocolSettings ?? {
            defaultNamespace: "com.amazonaws.secretsmanager",
            errorTypeRegistries: schemas_0_1.errorTypeRegistries,
            version: "2017-10-17",
            serviceTarget: "secretsmanager",
        },
        serviceId: config?.serviceId ?? "Secrets Manager",
        urlParser: config?.urlParser ?? url_parser_1.parseUrl,
        utf8Decoder: config?.utf8Decoder ?? util_utf8_1.fromUtf8,
        utf8Encoder: config?.utf8Encoder ?? util_utf8_1.toUtf8,
    };
};
exports.getRuntimeConfig = getRuntimeConfig;


/***/ }),

/***/ 88790:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.RestoreSecretRequest$ = exports.ReplicationStatusType$ = exports.ReplicateSecretToRegionsResponse$ = exports.ReplicateSecretToRegionsRequest$ = exports.ReplicaRegionType$ = exports.RemoveRegionsFromReplicationResponse$ = exports.RemoveRegionsFromReplicationRequest$ = exports.PutSecretValueResponse$ = exports.PutSecretValueRequest$ = exports.PutResourcePolicyResponse$ = exports.PutResourcePolicyRequest$ = exports.ListSecretVersionIdsResponse$ = exports.ListSecretVersionIdsRequest$ = exports.ListSecretsResponse$ = exports.ListSecretsRequest$ = exports.GetSecretValueResponse$ = exports.GetSecretValueRequest$ = exports.GetResourcePolicyResponse$ = exports.GetResourcePolicyRequest$ = exports.GetRandomPasswordResponse$ = exports.GetRandomPasswordRequest$ = exports.Filter$ = exports.ExternalSecretRotationMetadataItem$ = exports.DescribeSecretResponse$ = exports.DescribeSecretRequest$ = exports.DeleteSecretResponse$ = exports.DeleteSecretRequest$ = exports.DeleteResourcePolicyResponse$ = exports.DeleteResourcePolicyRequest$ = exports.CreateSecretResponse$ = exports.CreateSecretRequest$ = exports.CancelRotateSecretResponse$ = exports.CancelRotateSecretRequest$ = exports.BatchGetSecretValueResponse$ = exports.BatchGetSecretValueRequest$ = exports.APIErrorType$ = exports.errorTypeRegistries = exports.ResourceNotFoundException$ = exports.ResourceExistsException$ = exports.PublicPolicyException$ = exports.PreconditionNotMetException$ = exports.MalformedPolicyDocumentException$ = exports.LimitExceededException$ = exports.InvalidRequestException$ = exports.InvalidParameterException$ = exports.InvalidNextTokenException$ = exports.InternalServiceError$ = exports.EncryptionFailure$ = exports.DecryptionFailure$ = exports.SecretsManagerServiceException$ = void 0;
exports.ValidateResourcePolicy$ = exports.UpdateSecretVersionStage$ = exports.UpdateSecret$ = exports.UntagResource$ = exports.TagResource$ = exports.StopReplicationToReplica$ = exports.RotateSecret$ = exports.RestoreSecret$ = exports.ReplicateSecretToRegions$ = exports.RemoveRegionsFromReplication$ = exports.PutSecretValue$ = exports.PutResourcePolicy$ = exports.ListSecretVersionIds$ = exports.ListSecrets$ = exports.GetSecretValue$ = exports.GetResourcePolicy$ = exports.GetRandomPassword$ = exports.DescribeSecret$ = exports.DeleteSecret$ = exports.DeleteResourcePolicy$ = exports.CreateSecret$ = exports.CancelRotateSecret$ = exports.BatchGetSecretValue$ = exports.ValidationErrorsEntry$ = exports.ValidateResourcePolicyResponse$ = exports.ValidateResourcePolicyRequest$ = exports.UpdateSecretVersionStageResponse$ = exports.UpdateSecretVersionStageRequest$ = exports.UpdateSecretResponse$ = exports.UpdateSecretRequest$ = exports.UntagResourceRequest$ = exports.TagResourceRequest$ = exports.Tag$ = exports.StopReplicationToReplicaResponse$ = exports.StopReplicationToReplicaRequest$ = exports.SecretVersionsListEntry$ = exports.SecretValueEntry$ = exports.SecretListEntry$ = exports.RotationRulesType$ = exports.RotateSecretResponse$ = exports.RotateSecretRequest$ = exports.RestoreSecretResponse$ = void 0;
const _AAD = "AutomaticallyAfterDays";
const _APIELT = "APIErrorListType";
const _APIET = "APIErrorType";
const _ARN = "ARN";
const _ARR = "AddReplicaRegions";
const _ARRLT = "AddReplicaRegionListType";
const _BGSV = "BatchGetSecretValue";
const _BGSVR = "BatchGetSecretValueRequest";
const _BGSVRa = "BatchGetSecretValueResponse";
const _BPP = "BlockPublicPolicy";
const _CD = "CreatedDate";
const _CN = "CheckName";
const _CRS = "CancelRotateSecret";
const _CRSR = "CancelRotateSecretRequest";
const _CRSRa = "CancelRotateSecretResponse";
const _CRT = "ClientRequestToken";
const _CS = "CreateSecret";
const _CSR = "CreateSecretRequest";
const _CSRr = "CreateSecretResponse";
const _D = "Description";
const _DD = "DeletionDate";
const _DDe = "DeletedDate";
const _DF = "DecryptionFailure";
const _DRP = "DeleteResourcePolicy";
const _DRPR = "DeleteResourcePolicyRequest";
const _DRPRe = "DeleteResourcePolicyResponse";
const _DS = "DeleteSecret";
const _DSR = "DeleteSecretRequest";
const _DSRe = "DeleteSecretResponse";
const _DSRes = "DescribeSecretRequest";
const _DSResc = "DescribeSecretResponse";
const _DSe = "DescribeSecret";
const _Du = "Duration";
const _E = "Errors";
const _EC = "ErrorCode";
const _ECx = "ExcludeCharacters";
const _EF = "EncryptionFailure";
const _EL = "ExcludeLowercase";
const _EM = "ErrorMessage";
const _EN = "ExcludeNumbers";
const _EP = "ExcludePunctuation";
const _ESRM = "ExternalSecretRotationMetadata";
const _ESRMI = "ExternalSecretRotationMetadataItem";
const _ESRMT = "ExternalSecretRotationMetadataType";
const _ESRRA = "ExternalSecretRotationRoleArn";
const _EU = "ExcludeUppercase";
const _F = "Filters";
const _FDWR = "ForceDeleteWithoutRecovery";
const _FLT = "FiltersListType";
const _FORS = "ForceOverwriteReplicaSecret";
const _Fi = "Filter";
const _GRP = "GetRandomPassword";
const _GRPR = "GetRandomPasswordRequest";
const _GRPRe = "GetRandomPasswordResponse";
const _GRPRet = "GetResourcePolicyRequest";
const _GRPRete = "GetResourcePolicyResponse";
const _GRPe = "GetResourcePolicy";
const _GSV = "GetSecretValue";
const _GSVR = "GetSecretValueRequest";
const _GSVRe = "GetSecretValueResponse";
const _ID = "IncludeDeprecated";
const _INTE = "InvalidNextTokenException";
const _IPD = "IncludePlannedDeletion";
const _IPE = "InvalidParameterException";
const _IRE = "InvalidRequestException";
const _IS = "IncludeSpace";
const _ISE = "InternalServiceError";
const _K = "Key";
const _KKI = "KmsKeyId";
const _KKIm = "KmsKeyIds";
const _LAD = "LastAccessedDate";
const _LCD = "LastChangedDate";
const _LEE = "LimitExceededException";
const _LRD = "LastRotatedDate";
const _LS = "ListSecrets";
const _LSR = "ListSecretsRequest";
const _LSRi = "ListSecretsResponse";
const _LSVI = "ListSecretVersionIds";
const _LSVIR = "ListSecretVersionIdsRequest";
const _LSVIRi = "ListSecretVersionIdsResponse";
const _M = "Message";
const _MPDE = "MalformedPolicyDocumentException";
const _MR = "MaxResults";
const _MTVI = "MoveToVersionId";
const _N = "Name";
const _NRD = "NextRotationDate";
const _NT = "NextToken";
const _OS = "OwningService";
const _PL = "PasswordLength";
const _PNME = "PreconditionNotMetException";
const _PPE = "PublicPolicyException";
const _PR = "PrimaryRegion";
const _PRP = "PutResourcePolicy";
const _PRPR = "PutResourcePolicyRequest";
const _PRPRu = "PutResourcePolicyResponse";
const _PSV = "PutSecretValue";
const _PSVR = "PutSecretValueRequest";
const _PSVRu = "PutSecretValueResponse";
const _PVP = "PolicyValidationPassed";
const _R = "Region";
const _RE = "RotationEnabled";
const _REE = "ResourceExistsException";
const _REIT = "RequireEachIncludedType";
const _RFVI = "RemoveFromVersionId";
const _RI = "RotateImmediately";
const _RLARN = "RotationLambdaARN";
const _RNFE = "ResourceNotFoundException";
const _RP = "RandomPassword";
const _RPT = "RandomPasswordType";
const _RPe = "ResourcePolicy";
const _RR = "RotationRules";
const _RRFR = "RemoveRegionsFromReplication";
const _RRFRR = "RemoveRegionsFromReplicationRequest";
const _RRFRRe = "RemoveRegionsFromReplicationResponse";
const _RRR = "RemoveReplicaRegions";
const _RRT = "ReplicaRegionType";
const _RRTo = "RotationRulesType";
const _RS = "ReplicationStatus";
const _RSLT = "ReplicationStatusListType";
const _RSR = "RestoreSecretRequest";
const _RSRe = "RestoreSecretResponse";
const _RSRo = "RotateSecretRequest";
const _RSRot = "RotateSecretResponse";
const _RST = "ReplicationStatusType";
const _RSTR = "ReplicateSecretToRegions";
const _RSTRR = "ReplicateSecretToRegionsRequest";
const _RSTRRe = "ReplicateSecretToRegionsResponse";
const _RSe = "RestoreSecret";
const _RSo = "RotateSecret";
const _RT = "RotationToken";
const _RTT = "RotationTokenType";
const _RWID = "RecoveryWindowInDays";
const _S = "Status";
const _SB = "SecretBinary";
const _SBT = "SecretBinaryType";
const _SBo = "SortBy";
const _SE = "ScheduleExpression";
const _SI = "SecretId";
const _SIL = "SecretIdList";
const _SL = "SecretList";
const _SLE = "SecretListEntry";
const _SLT = "SecretListType";
const _SM = "StatusMessage";
const _SO = "SortOrder";
const _SRTR = "StopReplicationToReplica";
const _SRTRR = "StopReplicationToReplicaRequest";
const _SRTRRt = "StopReplicationToReplicaResponse";
const _SS = "SecretString";
const _SST = "SecretStringType";
const _SV = "SecretValues";
const _SVE = "SecretValueEntry";
const _SVLE = "SecretVersionsListEntry";
const _SVLT = "SecretVersionsListType";
const _SVT = "SecretValuesType";
const _SVTS = "SecretVersionsToStages";
const _SVTSMT = "SecretVersionsToStagesMapType";
const _T = "Tags";
const _TK = "TagKeys";
const _TLT = "TagListType";
const _TR = "TagResource";
const _TRR = "TagResourceRequest";
const _Ta = "Tag";
const _Ty = "Type";
const _UR = "UntagResource";
const _URR = "UntagResourceRequest";
const _US = "UpdateSecret";
const _USR = "UpdateSecretRequest";
const _USRp = "UpdateSecretResponse";
const _USVS = "UpdateSecretVersionStage";
const _USVSR = "UpdateSecretVersionStageRequest";
const _USVSRp = "UpdateSecretVersionStageResponse";
const _V = "Value";
const _VE = "ValidationErrors";
const _VEE = "ValidationErrorsEntry";
const _VET = "ValidationErrorsType";
const _VI = "VersionId";
const _VITS = "VersionIdsToStages";
const _VRP = "ValidateResourcePolicy";
const _VRPR = "ValidateResourcePolicyRequest";
const _VRPRa = "ValidateResourcePolicyResponse";
const _VS = "VersionStage";
const _VSe = "VersionStages";
const _Va = "Values";
const _Ve = "Versions";
const _c = "client";
const _e = "error";
const _s = "smithy.ts.sdk.synthetic.com.amazonaws.secretsmanager";
const _se = "server";
const n0 = "com.amazonaws.secretsmanager";
const schema_1 = __webpack_require__(15982);
const errors_1 = __webpack_require__(15994);
const SecretsManagerServiceException_1 = __webpack_require__(14417);
const _s_registry = schema_1.TypeRegistry.for(_s);
exports.SecretsManagerServiceException$ = [-3, _s, "SecretsManagerServiceException", 0, [], []];
_s_registry.registerError(exports.SecretsManagerServiceException$, SecretsManagerServiceException_1.SecretsManagerServiceException);
const n0_registry = schema_1.TypeRegistry.for(n0);
exports.DecryptionFailure$ = [-3, n0, _DF,
    { [_e]: _c },
    [_M],
    [0]
];
n0_registry.registerError(exports.DecryptionFailure$, errors_1.DecryptionFailure);
exports.EncryptionFailure$ = [-3, n0, _EF,
    { [_e]: _c },
    [_M],
    [0]
];
n0_registry.registerError(exports.EncryptionFailure$, errors_1.EncryptionFailure);
exports.InternalServiceError$ = [-3, n0, _ISE,
    { [_e]: _se },
    [_M],
    [0]
];
n0_registry.registerError(exports.InternalServiceError$, errors_1.InternalServiceError);
exports.InvalidNextTokenException$ = [-3, n0, _INTE,
    { [_e]: _c },
    [_M],
    [0]
];
n0_registry.registerError(exports.InvalidNextTokenException$, errors_1.InvalidNextTokenException);
exports.InvalidParameterException$ = [-3, n0, _IPE,
    { [_e]: _c },
    [_M],
    [0]
];
n0_registry.registerError(exports.InvalidParameterException$, errors_1.InvalidParameterException);
exports.InvalidRequestException$ = [-3, n0, _IRE,
    { [_e]: _c },
    [_M],
    [0]
];
n0_registry.registerError(exports.InvalidRequestException$, errors_1.InvalidRequestException);
exports.LimitExceededException$ = [-3, n0, _LEE,
    { [_e]: _c },
    [_M],
    [0]
];
n0_registry.registerError(exports.LimitExceededException$, errors_1.LimitExceededException);
exports.MalformedPolicyDocumentException$ = [-3, n0, _MPDE,
    { [_e]: _c },
    [_M],
    [0]
];
n0_registry.registerError(exports.MalformedPolicyDocumentException$, errors_1.MalformedPolicyDocumentException);
exports.PreconditionNotMetException$ = [-3, n0, _PNME,
    { [_e]: _c },
    [_M],
    [0]
];
n0_registry.registerError(exports.PreconditionNotMetException$, errors_1.PreconditionNotMetException);
exports.PublicPolicyException$ = [-3, n0, _PPE,
    { [_e]: _c },
    [_M],
    [0]
];
n0_registry.registerError(exports.PublicPolicyException$, errors_1.PublicPolicyException);
exports.ResourceExistsException$ = [-3, n0, _REE,
    { [_e]: _c },
    [_M],
    [0]
];
n0_registry.registerError(exports.ResourceExistsException$, errors_1.ResourceExistsException);
exports.ResourceNotFoundException$ = [-3, n0, _RNFE,
    { [_e]: _c },
    [_M],
    [0]
];
n0_registry.registerError(exports.ResourceNotFoundException$, errors_1.ResourceNotFoundException);
exports.errorTypeRegistries = [
    _s_registry,
    n0_registry,
];
var RandomPasswordType = [0, n0, _RPT, 8, 0];
var RotationTokenType = [0, n0, _RTT, 8, 0];
var SecretBinaryType = [0, n0, _SBT, 8, 21];
var SecretStringType = [0, n0, _SST, 8, 0];
exports.APIErrorType$ = [3, n0, _APIET,
    0,
    [_SI, _EC, _M],
    [0, 0, 0]
];
exports.BatchGetSecretValueRequest$ = [3, n0, _BGSVR,
    0,
    [_SIL, _F, _MR, _NT],
    [64 | 0, () => FiltersListType, 1, 0]
];
exports.BatchGetSecretValueResponse$ = [3, n0, _BGSVRa,
    0,
    [_SV, _NT, _E],
    [[() => SecretValuesType, 0], 0, () => APIErrorListType]
];
exports.CancelRotateSecretRequest$ = [3, n0, _CRSR,
    0,
    [_SI],
    [0], 1
];
exports.CancelRotateSecretResponse$ = [3, n0, _CRSRa,
    0,
    [_ARN, _N, _VI],
    [0, 0, 0]
];
exports.CreateSecretRequest$ = [3, n0, _CSR,
    0,
    [_N, _CRT, _D, _KKI, _SB, _SS, _T, _ARR, _FORS, _Ty],
    [0, [0, 4], 0, 0, [() => SecretBinaryType, 0], [() => SecretStringType, 0], () => TagListType, () => AddReplicaRegionListType, 2, 0], 1
];
exports.CreateSecretResponse$ = [3, n0, _CSRr,
    0,
    [_ARN, _N, _VI, _RS],
    [0, 0, 0, () => ReplicationStatusListType]
];
exports.DeleteResourcePolicyRequest$ = [3, n0, _DRPR,
    0,
    [_SI],
    [0], 1
];
exports.DeleteResourcePolicyResponse$ = [3, n0, _DRPRe,
    0,
    [_ARN, _N],
    [0, 0]
];
exports.DeleteSecretRequest$ = [3, n0, _DSR,
    0,
    [_SI, _RWID, _FDWR],
    [0, 1, 2], 1
];
exports.DeleteSecretResponse$ = [3, n0, _DSRe,
    0,
    [_ARN, _N, _DD],
    [0, 0, 4]
];
exports.DescribeSecretRequest$ = [3, n0, _DSRes,
    0,
    [_SI],
    [0], 1
];
exports.DescribeSecretResponse$ = [3, n0, _DSResc,
    0,
    [_ARN, _N, _Ty, _D, _KKI, _RE, _RLARN, _RR, _ESRM, _ESRRA, _LRD, _LCD, _LAD, _DDe, _NRD, _T, _VITS, _OS, _CD, _PR, _RS],
    [0, 0, 0, 0, 0, 2, 0, () => exports.RotationRulesType$, () => ExternalSecretRotationMetadataType, 0, 4, 4, 4, 4, 4, () => TagListType, [2, n0, _SVTSMT, 0, 0, 64 | 0], 0, 4, 0, () => ReplicationStatusListType]
];
exports.ExternalSecretRotationMetadataItem$ = [3, n0, _ESRMI,
    0,
    [_K, _V],
    [0, 0]
];
exports.Filter$ = [3, n0, _Fi,
    0,
    [_K, _Va],
    [0, 64 | 0]
];
exports.GetRandomPasswordRequest$ = [3, n0, _GRPR,
    0,
    [_PL, _ECx, _EN, _EP, _EU, _EL, _IS, _REIT],
    [1, 0, 2, 2, 2, 2, 2, 2]
];
exports.GetRandomPasswordResponse$ = [3, n0, _GRPRe,
    0,
    [_RP],
    [[() => RandomPasswordType, 0]]
];
exports.GetResourcePolicyRequest$ = [3, n0, _GRPRet,
    0,
    [_SI],
    [0], 1
];
exports.GetResourcePolicyResponse$ = [3, n0, _GRPRete,
    0,
    [_ARN, _N, _RPe],
    [0, 0, 0]
];
exports.GetSecretValueRequest$ = [3, n0, _GSVR,
    0,
    [_SI, _VI, _VS],
    [0, 0, 0], 1
];
exports.GetSecretValueResponse$ = [3, n0, _GSVRe,
    0,
    [_ARN, _N, _VI, _SB, _SS, _VSe, _CD],
    [0, 0, 0, [() => SecretBinaryType, 0], [() => SecretStringType, 0], 64 | 0, 4]
];
exports.ListSecretsRequest$ = [3, n0, _LSR,
    0,
    [_IPD, _MR, _NT, _F, _SO, _SBo],
    [2, 1, 0, () => FiltersListType, 0, 0]
];
exports.ListSecretsResponse$ = [3, n0, _LSRi,
    0,
    [_SL, _NT],
    [() => SecretListType, 0]
];
exports.ListSecretVersionIdsRequest$ = [3, n0, _LSVIR,
    0,
    [_SI, _MR, _NT, _ID],
    [0, 1, 0, 2], 1
];
exports.ListSecretVersionIdsResponse$ = [3, n0, _LSVIRi,
    0,
    [_Ve, _NT, _ARN, _N],
    [() => SecretVersionsListType, 0, 0, 0]
];
exports.PutResourcePolicyRequest$ = [3, n0, _PRPR,
    0,
    [_SI, _RPe, _BPP],
    [0, 0, 2], 2
];
exports.PutResourcePolicyResponse$ = [3, n0, _PRPRu,
    0,
    [_ARN, _N],
    [0, 0]
];
exports.PutSecretValueRequest$ = [3, n0, _PSVR,
    0,
    [_SI, _CRT, _SB, _SS, _VSe, _RT],
    [0, [0, 4], [() => SecretBinaryType, 0], [() => SecretStringType, 0], 64 | 0, [() => RotationTokenType, 0]], 1
];
exports.PutSecretValueResponse$ = [3, n0, _PSVRu,
    0,
    [_ARN, _N, _VI, _VSe],
    [0, 0, 0, 64 | 0]
];
exports.RemoveRegionsFromReplicationRequest$ = [3, n0, _RRFRR,
    0,
    [_SI, _RRR],
    [0, 64 | 0], 2
];
exports.RemoveRegionsFromReplicationResponse$ = [3, n0, _RRFRRe,
    0,
    [_ARN, _RS],
    [0, () => ReplicationStatusListType]
];
exports.ReplicaRegionType$ = [3, n0, _RRT,
    0,
    [_R, _KKI],
    [0, 0]
];
exports.ReplicateSecretToRegionsRequest$ = [3, n0, _RSTRR,
    0,
    [_SI, _ARR, _FORS],
    [0, () => AddReplicaRegionListType, 2], 2
];
exports.ReplicateSecretToRegionsResponse$ = [3, n0, _RSTRRe,
    0,
    [_ARN, _RS],
    [0, () => ReplicationStatusListType]
];
exports.ReplicationStatusType$ = [3, n0, _RST,
    0,
    [_R, _KKI, _S, _SM, _LAD],
    [0, 0, 0, 0, 4]
];
exports.RestoreSecretRequest$ = [3, n0, _RSR,
    0,
    [_SI],
    [0], 1
];
exports.RestoreSecretResponse$ = [3, n0, _RSRe,
    0,
    [_ARN, _N],
    [0, 0]
];
exports.RotateSecretRequest$ = [3, n0, _RSRo,
    0,
    [_SI, _CRT, _RLARN, _RR, _ESRM, _ESRRA, _RI],
    [0, [0, 4], 0, () => exports.RotationRulesType$, () => ExternalSecretRotationMetadataType, 0, 2], 1
];
exports.RotateSecretResponse$ = [3, n0, _RSRot,
    0,
    [_ARN, _N, _VI],
    [0, 0, 0]
];
exports.RotationRulesType$ = [3, n0, _RRTo,
    0,
    [_AAD, _Du, _SE],
    [1, 0, 0]
];
exports.SecretListEntry$ = [3, n0, _SLE,
    0,
    [_ARN, _N, _Ty, _D, _KKI, _RE, _RLARN, _RR, _ESRM, _ESRRA, _LRD, _LCD, _LAD, _DDe, _NRD, _T, _SVTS, _OS, _CD, _PR],
    [0, 0, 0, 0, 0, 2, 0, () => exports.RotationRulesType$, () => ExternalSecretRotationMetadataType, 0, 4, 4, 4, 4, 4, () => TagListType, [2, n0, _SVTSMT, 0, 0, 64 | 0], 0, 4, 0]
];
exports.SecretValueEntry$ = [3, n0, _SVE,
    0,
    [_ARN, _N, _VI, _SB, _SS, _VSe, _CD],
    [0, 0, 0, [() => SecretBinaryType, 0], [() => SecretStringType, 0], 64 | 0, 4]
];
exports.SecretVersionsListEntry$ = [3, n0, _SVLE,
    0,
    [_VI, _VSe, _LAD, _CD, _KKIm],
    [0, 64 | 0, 4, 4, 64 | 0]
];
exports.StopReplicationToReplicaRequest$ = [3, n0, _SRTRR,
    0,
    [_SI],
    [0], 1
];
exports.StopReplicationToReplicaResponse$ = [3, n0, _SRTRRt,
    0,
    [_ARN],
    [0]
];
exports.Tag$ = [3, n0, _Ta,
    0,
    [_K, _V],
    [0, 0]
];
exports.TagResourceRequest$ = [3, n0, _TRR,
    0,
    [_SI, _T],
    [0, () => TagListType], 2
];
exports.UntagResourceRequest$ = [3, n0, _URR,
    0,
    [_SI, _TK],
    [0, 64 | 0], 2
];
exports.UpdateSecretRequest$ = [3, n0, _USR,
    0,
    [_SI, _CRT, _D, _KKI, _SB, _SS, _Ty],
    [0, [0, 4], 0, 0, [() => SecretBinaryType, 0], [() => SecretStringType, 0], 0], 1
];
exports.UpdateSecretResponse$ = [3, n0, _USRp,
    0,
    [_ARN, _N, _VI],
    [0, 0, 0]
];
exports.UpdateSecretVersionStageRequest$ = [3, n0, _USVSR,
    0,
    [_SI, _VS, _RFVI, _MTVI],
    [0, 0, 0, 0], 2
];
exports.UpdateSecretVersionStageResponse$ = [3, n0, _USVSRp,
    0,
    [_ARN, _N],
    [0, 0]
];
exports.ValidateResourcePolicyRequest$ = [3, n0, _VRPR,
    0,
    [_RPe, _SI],
    [0, 0], 1
];
exports.ValidateResourcePolicyResponse$ = [3, n0, _VRPRa,
    0,
    [_PVP, _VE],
    [2, () => ValidationErrorsType]
];
exports.ValidationErrorsEntry$ = [3, n0, _VEE,
    0,
    [_CN, _EM],
    [0, 0]
];
var __Unit = "unit";
var AddReplicaRegionListType = [1, n0, _ARRLT,
    0, () => exports.ReplicaRegionType$
];
var APIErrorListType = [1, n0, _APIELT,
    0, () => exports.APIErrorType$
];
var ExternalSecretRotationMetadataType = [1, n0, _ESRMT,
    0, () => exports.ExternalSecretRotationMetadataItem$
];
var FiltersListType = [1, n0, _FLT,
    0, () => exports.Filter$
];
var FilterValuesStringList = (/* unused pure expression or super */ null && (64 | 0));
var KmsKeyIdListType = (/* unused pure expression or super */ null && (64 | 0));
var RemoveReplicaRegionListType = (/* unused pure expression or super */ null && (64 | 0));
var ReplicationStatusListType = [1, n0, _RSLT,
    0, () => exports.ReplicationStatusType$
];
var SecretIdListType = (/* unused pure expression or super */ null && (64 | 0));
var SecretListType = [1, n0, _SLT,
    0, () => exports.SecretListEntry$
];
var SecretValuesType = [1, n0, _SVT,
    0, [() => exports.SecretValueEntry$,
        0]
];
var SecretVersionsListType = [1, n0, _SVLT,
    0, () => exports.SecretVersionsListEntry$
];
var SecretVersionStagesType = (/* unused pure expression or super */ null && (64 | 0));
var TagKeyListType = (/* unused pure expression or super */ null && (64 | 0));
var TagListType = [1, n0, _TLT,
    0, () => exports.Tag$
];
var ValidationErrorsType = [1, n0, _VET,
    0, () => exports.ValidationErrorsEntry$
];
var SecretVersionsToStagesMapType = [2, n0, _SVTSMT,
    0, 0, 64 | 0
];
exports.BatchGetSecretValue$ = [9, n0, _BGSV,
    0, () => exports.BatchGetSecretValueRequest$, () => exports.BatchGetSecretValueResponse$
];
exports.CancelRotateSecret$ = [9, n0, _CRS,
    0, () => exports.CancelRotateSecretRequest$, () => exports.CancelRotateSecretResponse$
];
exports.CreateSecret$ = [9, n0, _CS,
    0, () => exports.CreateSecretRequest$, () => exports.CreateSecretResponse$
];
exports.DeleteResourcePolicy$ = [9, n0, _DRP,
    0, () => exports.DeleteResourcePolicyRequest$, () => exports.DeleteResourcePolicyResponse$
];
exports.DeleteSecret$ = [9, n0, _DS,
    0, () => exports.DeleteSecretRequest$, () => exports.DeleteSecretResponse$
];
exports.DescribeSecret$ = [9, n0, _DSe,
    0, () => exports.DescribeSecretRequest$, () => exports.DescribeSecretResponse$
];
exports.GetRandomPassword$ = [9, n0, _GRP,
    0, () => exports.GetRandomPasswordRequest$, () => exports.GetRandomPasswordResponse$
];
exports.GetResourcePolicy$ = [9, n0, _GRPe,
    0, () => exports.GetResourcePolicyRequest$, () => exports.GetResourcePolicyResponse$
];
exports.GetSecretValue$ = [9, n0, _GSV,
    0, () => exports.GetSecretValueRequest$, () => exports.GetSecretValueResponse$
];
exports.ListSecrets$ = [9, n0, _LS,
    0, () => exports.ListSecretsRequest$, () => exports.ListSecretsResponse$
];
exports.ListSecretVersionIds$ = [9, n0, _LSVI,
    0, () => exports.ListSecretVersionIdsRequest$, () => exports.ListSecretVersionIdsResponse$
];
exports.PutResourcePolicy$ = [9, n0, _PRP,
    0, () => exports.PutResourcePolicyRequest$, () => exports.PutResourcePolicyResponse$
];
exports.PutSecretValue$ = [9, n0, _PSV,
    0, () => exports.PutSecretValueRequest$, () => exports.PutSecretValueResponse$
];
exports.RemoveRegionsFromReplication$ = [9, n0, _RRFR,
    0, () => exports.RemoveRegionsFromReplicationRequest$, () => exports.RemoveRegionsFromReplicationResponse$
];
exports.ReplicateSecretToRegions$ = [9, n0, _RSTR,
    0, () => exports.ReplicateSecretToRegionsRequest$, () => exports.ReplicateSecretToRegionsResponse$
];
exports.RestoreSecret$ = [9, n0, _RSe,
    0, () => exports.RestoreSecretRequest$, () => exports.RestoreSecretResponse$
];
exports.RotateSecret$ = [9, n0, _RSo,
    0, () => exports.RotateSecretRequest$, () => exports.RotateSecretResponse$
];
exports.StopReplicationToReplica$ = [9, n0, _SRTR,
    0, () => exports.StopReplicationToReplicaRequest$, () => exports.StopReplicationToReplicaResponse$
];
exports.TagResource$ = [9, n0, _TR,
    0, () => exports.TagResourceRequest$, () => __Unit
];
exports.UntagResource$ = [9, n0, _UR,
    0, () => exports.UntagResourceRequest$, () => __Unit
];
exports.UpdateSecret$ = [9, n0, _US,
    0, () => exports.UpdateSecretRequest$, () => exports.UpdateSecretResponse$
];
exports.UpdateSecretVersionStage$ = [9, n0, _USVS,
    0, () => exports.UpdateSecretVersionStageRequest$, () => exports.UpdateSecretVersionStageResponse$
];
exports.ValidateResourcePolicy$ = [9, n0, _VRP,
    0, () => exports.ValidateResourcePolicyRequest$, () => exports.ValidateResourcePolicyResponse$
];


/***/ }),

/***/ 59361:
/***/ ((module) => {

module.exports = /*#__PURE__*/JSON.parse('{"name":"@aws-sdk/client-secrets-manager","description":"AWS SDK for JavaScript Secrets Manager Client for Node.js, Browser and React Native","version":"3.1004.0","scripts":{"build":"concurrently \'yarn:build:types\' \'yarn:build:es\' && yarn build:cjs","build:cjs":"node ../../scripts/compilation/inline client-secrets-manager","build:es":"tsc -p tsconfig.es.json","build:include:deps":"yarn g:turbo run build -F=\\"$npm_package_name\\"","build:types":"tsc -p tsconfig.types.json","build:types:downlevel":"downlevel-dts dist-types dist-types/ts3.4","clean":"premove dist-cjs dist-es dist-types tsconfig.cjs.tsbuildinfo tsconfig.es.tsbuildinfo tsconfig.types.tsbuildinfo","extract:docs":"api-extractor run --local","generate:client":"node ../../scripts/generate-clients/single-service --solo secrets-manager","test":"yarn g:vitest run --passWithNoTests","test:index":"tsc --noEmit ./test/index-types.ts && node ./test/index-objects.spec.mjs","test:integration":"yarn g:vitest run --passWithNoTests -c vitest.config.integ.mts","test:integration:watch":"yarn g:vitest run --passWithNoTests -c vitest.config.integ.mts","test:watch":"yarn g:vitest watch --passWithNoTests"},"main":"./dist-cjs/index.js","types":"./dist-types/index.d.ts","module":"./dist-es/index.js","sideEffects":false,"dependencies":{"@aws-crypto/sha256-browser":"5.2.0","@aws-crypto/sha256-js":"5.2.0","@aws-sdk/core":"^3.973.18","@aws-sdk/credential-provider-node":"^3.972.18","@aws-sdk/middleware-host-header":"^3.972.7","@aws-sdk/middleware-logger":"^3.972.7","@aws-sdk/middleware-recursion-detection":"^3.972.7","@aws-sdk/middleware-user-agent":"^3.972.19","@aws-sdk/region-config-resolver":"^3.972.7","@aws-sdk/types":"^3.973.5","@aws-sdk/util-endpoints":"^3.996.4","@aws-sdk/util-user-agent-browser":"^3.972.7","@aws-sdk/util-user-agent-node":"^3.973.4","@smithy/config-resolver":"^4.4.10","@smithy/core":"^3.23.8","@smithy/fetch-http-handler":"^5.3.13","@smithy/hash-node":"^4.2.11","@smithy/invalid-dependency":"^4.2.11","@smithy/middleware-content-length":"^4.2.11","@smithy/middleware-endpoint":"^4.4.22","@smithy/middleware-retry":"^4.4.39","@smithy/middleware-serde":"^4.2.12","@smithy/middleware-stack":"^4.2.11","@smithy/node-config-provider":"^4.3.11","@smithy/node-http-handler":"^4.4.14","@smithy/protocol-http":"^5.3.11","@smithy/smithy-client":"^4.12.2","@smithy/types":"^4.13.0","@smithy/url-parser":"^4.2.11","@smithy/util-base64":"^4.3.2","@smithy/util-body-length-browser":"^4.2.2","@smithy/util-body-length-node":"^4.2.3","@smithy/util-defaults-mode-browser":"^4.3.38","@smithy/util-defaults-mode-node":"^4.2.41","@smithy/util-endpoints":"^3.3.2","@smithy/util-middleware":"^4.2.11","@smithy/util-retry":"^4.2.11","@smithy/util-utf8":"^4.2.2","tslib":"^2.6.2"},"devDependencies":{"@smithy/snapshot-testing":"^1.0.9","@tsconfig/node20":"20.1.8","@types/node":"^20.14.8","concurrently":"7.0.0","downlevel-dts":"0.10.1","premove":"4.0.0","typescript":"~5.8.3","vitest":"^4.0.17"},"engines":{"node":">=20.0.0"},"typesVersions":{"<4.5":{"dist-types/*":["dist-types/ts3.4/*"]}},"files":["dist-*/**"],"author":{"name":"AWS SDK for JavaScript Team","url":"https://aws.amazon.com/javascript/"},"license":"Apache-2.0","browser":{"./dist-es/runtimeConfig":"./dist-es/runtimeConfig.browser"},"react-native":{"./dist-es/runtimeConfig":"./dist-es/runtimeConfig.native"},"homepage":"https://github.com/aws/aws-sdk-js-v3/tree/main/clients/client-secrets-manager","repository":{"type":"git","url":"https://github.com/aws/aws-sdk-js-v3.git","directory":"clients/client-secrets-manager"}}');

/***/ })

};

//# sourceMappingURL=494.index.js.map