export const id = 107;
export const ids = [107];
export const modules = {

/***/ 78044:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.resolveHttpAuthSchemeConfig = exports.defaultCloudWatchLogsHttpAuthSchemeProvider = exports.defaultCloudWatchLogsHttpAuthSchemeParametersProvider = void 0;
const core_1 = __webpack_require__(39116);
const util_middleware_1 = __webpack_require__(54160);
const defaultCloudWatchLogsHttpAuthSchemeParametersProvider = async (config, context, input) => {
    return {
        operation: (0, util_middleware_1.getSmithyContext)(context).operation,
        region: await (0, util_middleware_1.normalizeProvider)(config.region)() || (() => {
            throw new Error("expected `region` to be configured for `aws.auth#sigv4`");
        })(),
    };
};
exports.defaultCloudWatchLogsHttpAuthSchemeParametersProvider = defaultCloudWatchLogsHttpAuthSchemeParametersProvider;
function createAwsAuthSigv4HttpAuthOption(authParameters) {
    return {
        schemeId: "aws.auth#sigv4",
        signingProperties: {
            name: "logs",
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
const defaultCloudWatchLogsHttpAuthSchemeProvider = (authParameters) => {
    const options = [];
    switch (authParameters.operation) {
        default: {
            options.push(createAwsAuthSigv4HttpAuthOption(authParameters));
        }
    }
    return options;
};
exports.defaultCloudWatchLogsHttpAuthSchemeProvider = defaultCloudWatchLogsHttpAuthSchemeProvider;
const resolveHttpAuthSchemeConfig = (config) => {
    const config_0 = (0, core_1.resolveAwsSdkSigV4Config)(config);
    return Object.assign(config_0, {
        authSchemePreference: (0, util_middleware_1.normalizeProvider)(config.authSchemePreference ?? []),
    });
};
exports.resolveHttpAuthSchemeConfig = resolveHttpAuthSchemeConfig;


/***/ }),

/***/ 16354:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.defaultEndpointResolver = void 0;
const util_endpoints_1 = __webpack_require__(94024);
const util_endpoints_2 = __webpack_require__(49622);
const ruleset_1 = __webpack_require__(48267);
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

/***/ 48267:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ruleSet = void 0;
const u = "required", v = "fn", w = "argv", x = "ref";
const a = true, b = "isSet", c = "booleanEquals", d = "error", e = "endpoint", f = "tree", g = "PartitionResult", h = "stringEquals", i = { [u]: false, "type": "string" }, j = { [u]: true, "default": false, "type": "boolean" }, k = { [x]: "Endpoint" }, l = { [v]: c, [w]: [{ [x]: "UseFIPS" }, true] }, m = { [v]: c, [w]: [{ [x]: "UseDualStack" }, true] }, n = {}, o = { [x]: "Region" }, p = { [v]: "getAttr", [w]: [{ [x]: g }, "supportsFIPS"] }, q = { [v]: c, [w]: [true, { [v]: "getAttr", [w]: [{ [x]: g }, "supportsDualStack"] }] }, r = [l], s = [m], t = [o];
const _data = { version: "1.0", parameters: { Region: i, UseDualStack: j, UseFIPS: j, Endpoint: i }, rules: [{ conditions: [{ [v]: b, [w]: [k] }], rules: [{ conditions: r, error: "Invalid Configuration: FIPS and custom endpoint are not supported", type: d }, { conditions: s, error: "Invalid Configuration: Dualstack and custom endpoint are not supported", type: d }, { endpoint: { url: k, properties: n, headers: n }, type: e }], type: f }, { conditions: [{ [v]: b, [w]: t }], rules: [{ conditions: [{ [v]: "aws.partition", [w]: t, assign: g }], rules: [{ conditions: [l, m], rules: [{ conditions: [{ [v]: c, [w]: [a, p] }, q], rules: [{ endpoint: { url: "https://logs-fips.{Region}.{PartitionResult#dualStackDnsSuffix}", properties: n, headers: n }, type: e }], type: f }, { error: "FIPS and DualStack are enabled, but this partition does not support one or both", type: d }], type: f }, { conditions: r, rules: [{ conditions: [{ [v]: c, [w]: [p, a] }], rules: [{ conditions: [{ [v]: h, [w]: [o, "us-gov-east-1"] }], endpoint: { url: "https://logs.us-gov-east-1.amazonaws.com", properties: n, headers: n }, type: e }, { conditions: [{ [v]: h, [w]: [o, "us-gov-west-1"] }], endpoint: { url: "https://logs.us-gov-west-1.amazonaws.com", properties: n, headers: n }, type: e }, { endpoint: { url: "https://logs-fips.{Region}.{PartitionResult#dnsSuffix}", properties: n, headers: n }, type: e }], type: f }, { error: "FIPS is enabled but this partition does not support FIPS", type: d }], type: f }, { conditions: s, rules: [{ conditions: [q], rules: [{ endpoint: { url: "https://logs.{Region}.{PartitionResult#dualStackDnsSuffix}", properties: n, headers: n }, type: e }], type: f }, { error: "DualStack is enabled but this partition does not support DualStack", type: d }], type: f }, { endpoint: { url: "https://logs.{Region}.{PartitionResult#dnsSuffix}", properties: n, headers: n }, type: e }], type: f }], type: f }, { error: "Invalid Configuration: Missing Region", type: d }] };
exports.ruleSet = _data;


/***/ }),

/***/ 1107:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var middlewareHostHeader = __webpack_require__(54746);
var middlewareLogger = __webpack_require__(10438);
var middlewareRecursionDetection = __webpack_require__(52588);
var middlewareUserAgent = __webpack_require__(3979);
var configResolver = __webpack_require__(93768);
var core = __webpack_require__(75086);
var schema = __webpack_require__(15982);
var eventstreamSerdeConfigResolver = __webpack_require__(23947);
var middlewareContentLength = __webpack_require__(82352);
var middlewareEndpoint = __webpack_require__(10775);
var middlewareRetry = __webpack_require__(46318);
var smithyClient = __webpack_require__(58015);
var httpAuthSchemeProvider = __webpack_require__(78044);
var runtimeConfig = __webpack_require__(48821);
var regionConfigResolver = __webpack_require__(52627);
var protocolHttp = __webpack_require__(29752);
var schemas_0 = __webpack_require__(11639);
var errors = __webpack_require__(8691);
var CloudWatchLogsServiceException = __webpack_require__(37951);

const resolveClientEndpointParameters = (options) => {
    return Object.assign(options, {
        useDualstackEndpoint: options.useDualstackEndpoint ?? false,
        useFipsEndpoint: options.useFipsEndpoint ?? false,
        defaultSigningName: "logs",
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

class CloudWatchLogsClient extends smithyClient.Client {
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
        const _config_7 = eventstreamSerdeConfigResolver.resolveEventStreamSerdeConfig(_config_6);
        const _config_8 = httpAuthSchemeProvider.resolveHttpAuthSchemeConfig(_config_7);
        const _config_9 = resolveRuntimeExtensions(_config_8, configuration?.extensions || []);
        this.config = _config_9;
        this.middlewareStack.use(schema.getSchemaSerdePlugin(this.config));
        this.middlewareStack.use(middlewareUserAgent.getUserAgentPlugin(this.config));
        this.middlewareStack.use(middlewareRetry.getRetryPlugin(this.config));
        this.middlewareStack.use(middlewareContentLength.getContentLengthPlugin(this.config));
        this.middlewareStack.use(middlewareHostHeader.getHostHeaderPlugin(this.config));
        this.middlewareStack.use(middlewareLogger.getLoggerPlugin(this.config));
        this.middlewareStack.use(middlewareRecursionDetection.getRecursionDetectionPlugin(this.config));
        this.middlewareStack.use(core.getHttpAuthSchemeEndpointRuleSetPlugin(this.config, {
            httpAuthSchemeParametersProvider: httpAuthSchemeProvider.defaultCloudWatchLogsHttpAuthSchemeParametersProvider,
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

class AssociateKmsKeyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "AssociateKmsKey", {})
    .n("CloudWatchLogsClient", "AssociateKmsKeyCommand")
    .sc(schemas_0.AssociateKmsKey$)
    .build() {
}

class AssociateSourceToS3TableIntegrationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "AssociateSourceToS3TableIntegration", {})
    .n("CloudWatchLogsClient", "AssociateSourceToS3TableIntegrationCommand")
    .sc(schemas_0.AssociateSourceToS3TableIntegration$)
    .build() {
}

class CancelExportTaskCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "CancelExportTask", {})
    .n("CloudWatchLogsClient", "CancelExportTaskCommand")
    .sc(schemas_0.CancelExportTask$)
    .build() {
}

class CancelImportTaskCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "CancelImportTask", {})
    .n("CloudWatchLogsClient", "CancelImportTaskCommand")
    .sc(schemas_0.CancelImportTask$)
    .build() {
}

class CreateDeliveryCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "CreateDelivery", {})
    .n("CloudWatchLogsClient", "CreateDeliveryCommand")
    .sc(schemas_0.CreateDelivery$)
    .build() {
}

class CreateExportTaskCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "CreateExportTask", {})
    .n("CloudWatchLogsClient", "CreateExportTaskCommand")
    .sc(schemas_0.CreateExportTask$)
    .build() {
}

class CreateImportTaskCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "CreateImportTask", {})
    .n("CloudWatchLogsClient", "CreateImportTaskCommand")
    .sc(schemas_0.CreateImportTask$)
    .build() {
}

class CreateLogAnomalyDetectorCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "CreateLogAnomalyDetector", {})
    .n("CloudWatchLogsClient", "CreateLogAnomalyDetectorCommand")
    .sc(schemas_0.CreateLogAnomalyDetector$)
    .build() {
}

class CreateLogGroupCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "CreateLogGroup", {})
    .n("CloudWatchLogsClient", "CreateLogGroupCommand")
    .sc(schemas_0.CreateLogGroup$)
    .build() {
}

class CreateLogStreamCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "CreateLogStream", {})
    .n("CloudWatchLogsClient", "CreateLogStreamCommand")
    .sc(schemas_0.CreateLogStream$)
    .build() {
}

class CreateScheduledQueryCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "CreateScheduledQuery", {})
    .n("CloudWatchLogsClient", "CreateScheduledQueryCommand")
    .sc(schemas_0.CreateScheduledQuery$)
    .build() {
}

class DeleteAccountPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteAccountPolicy", {})
    .n("CloudWatchLogsClient", "DeleteAccountPolicyCommand")
    .sc(schemas_0.DeleteAccountPolicy$)
    .build() {
}

class DeleteDataProtectionPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteDataProtectionPolicy", {})
    .n("CloudWatchLogsClient", "DeleteDataProtectionPolicyCommand")
    .sc(schemas_0.DeleteDataProtectionPolicy$)
    .build() {
}

class DeleteDeliveryCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteDelivery", {})
    .n("CloudWatchLogsClient", "DeleteDeliveryCommand")
    .sc(schemas_0.DeleteDelivery$)
    .build() {
}

class DeleteDeliveryDestinationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteDeliveryDestination", {})
    .n("CloudWatchLogsClient", "DeleteDeliveryDestinationCommand")
    .sc(schemas_0.DeleteDeliveryDestination$)
    .build() {
}

class DeleteDeliveryDestinationPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteDeliveryDestinationPolicy", {})
    .n("CloudWatchLogsClient", "DeleteDeliveryDestinationPolicyCommand")
    .sc(schemas_0.DeleteDeliveryDestinationPolicy$)
    .build() {
}

class DeleteDeliverySourceCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteDeliverySource", {})
    .n("CloudWatchLogsClient", "DeleteDeliverySourceCommand")
    .sc(schemas_0.DeleteDeliverySource$)
    .build() {
}

class DeleteDestinationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteDestination", {})
    .n("CloudWatchLogsClient", "DeleteDestinationCommand")
    .sc(schemas_0.DeleteDestination$)
    .build() {
}

class DeleteIndexPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteIndexPolicy", {})
    .n("CloudWatchLogsClient", "DeleteIndexPolicyCommand")
    .sc(schemas_0.DeleteIndexPolicy$)
    .build() {
}

class DeleteIntegrationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteIntegration", {})
    .n("CloudWatchLogsClient", "DeleteIntegrationCommand")
    .sc(schemas_0.DeleteIntegration$)
    .build() {
}

class DeleteLogAnomalyDetectorCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteLogAnomalyDetector", {})
    .n("CloudWatchLogsClient", "DeleteLogAnomalyDetectorCommand")
    .sc(schemas_0.DeleteLogAnomalyDetector$)
    .build() {
}

class DeleteLogGroupCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteLogGroup", {})
    .n("CloudWatchLogsClient", "DeleteLogGroupCommand")
    .sc(schemas_0.DeleteLogGroup$)
    .build() {
}

class DeleteLogStreamCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteLogStream", {})
    .n("CloudWatchLogsClient", "DeleteLogStreamCommand")
    .sc(schemas_0.DeleteLogStream$)
    .build() {
}

class DeleteMetricFilterCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteMetricFilter", {})
    .n("CloudWatchLogsClient", "DeleteMetricFilterCommand")
    .sc(schemas_0.DeleteMetricFilter$)
    .build() {
}

class DeleteQueryDefinitionCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteQueryDefinition", {})
    .n("CloudWatchLogsClient", "DeleteQueryDefinitionCommand")
    .sc(schemas_0.DeleteQueryDefinition$)
    .build() {
}

class DeleteResourcePolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteResourcePolicy", {})
    .n("CloudWatchLogsClient", "DeleteResourcePolicyCommand")
    .sc(schemas_0.DeleteResourcePolicy$)
    .build() {
}

class DeleteRetentionPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteRetentionPolicy", {})
    .n("CloudWatchLogsClient", "DeleteRetentionPolicyCommand")
    .sc(schemas_0.DeleteRetentionPolicy$)
    .build() {
}

class DeleteScheduledQueryCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteScheduledQuery", {})
    .n("CloudWatchLogsClient", "DeleteScheduledQueryCommand")
    .sc(schemas_0.DeleteScheduledQuery$)
    .build() {
}

class DeleteSubscriptionFilterCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteSubscriptionFilter", {})
    .n("CloudWatchLogsClient", "DeleteSubscriptionFilterCommand")
    .sc(schemas_0.DeleteSubscriptionFilter$)
    .build() {
}

class DeleteTransformerCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DeleteTransformer", {})
    .n("CloudWatchLogsClient", "DeleteTransformerCommand")
    .sc(schemas_0.DeleteTransformer$)
    .build() {
}

class DescribeAccountPoliciesCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeAccountPolicies", {})
    .n("CloudWatchLogsClient", "DescribeAccountPoliciesCommand")
    .sc(schemas_0.DescribeAccountPolicies$)
    .build() {
}

class DescribeConfigurationTemplatesCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeConfigurationTemplates", {})
    .n("CloudWatchLogsClient", "DescribeConfigurationTemplatesCommand")
    .sc(schemas_0.DescribeConfigurationTemplates$)
    .build() {
}

class DescribeDeliveriesCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeDeliveries", {})
    .n("CloudWatchLogsClient", "DescribeDeliveriesCommand")
    .sc(schemas_0.DescribeDeliveries$)
    .build() {
}

class DescribeDeliveryDestinationsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeDeliveryDestinations", {})
    .n("CloudWatchLogsClient", "DescribeDeliveryDestinationsCommand")
    .sc(schemas_0.DescribeDeliveryDestinations$)
    .build() {
}

class DescribeDeliverySourcesCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeDeliverySources", {})
    .n("CloudWatchLogsClient", "DescribeDeliverySourcesCommand")
    .sc(schemas_0.DescribeDeliverySources$)
    .build() {
}

class DescribeDestinationsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeDestinations", {})
    .n("CloudWatchLogsClient", "DescribeDestinationsCommand")
    .sc(schemas_0.DescribeDestinations$)
    .build() {
}

class DescribeExportTasksCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeExportTasks", {})
    .n("CloudWatchLogsClient", "DescribeExportTasksCommand")
    .sc(schemas_0.DescribeExportTasks$)
    .build() {
}

class DescribeFieldIndexesCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeFieldIndexes", {})
    .n("CloudWatchLogsClient", "DescribeFieldIndexesCommand")
    .sc(schemas_0.DescribeFieldIndexes$)
    .build() {
}

class DescribeImportTaskBatchesCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeImportTaskBatches", {})
    .n("CloudWatchLogsClient", "DescribeImportTaskBatchesCommand")
    .sc(schemas_0.DescribeImportTaskBatches$)
    .build() {
}

class DescribeImportTasksCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeImportTasks", {})
    .n("CloudWatchLogsClient", "DescribeImportTasksCommand")
    .sc(schemas_0.DescribeImportTasks$)
    .build() {
}

class DescribeIndexPoliciesCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeIndexPolicies", {})
    .n("CloudWatchLogsClient", "DescribeIndexPoliciesCommand")
    .sc(schemas_0.DescribeIndexPolicies$)
    .build() {
}

class DescribeLogGroupsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeLogGroups", {})
    .n("CloudWatchLogsClient", "DescribeLogGroupsCommand")
    .sc(schemas_0.DescribeLogGroups$)
    .build() {
}

class DescribeLogStreamsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeLogStreams", {})
    .n("CloudWatchLogsClient", "DescribeLogStreamsCommand")
    .sc(schemas_0.DescribeLogStreams$)
    .build() {
}

class DescribeMetricFiltersCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeMetricFilters", {})
    .n("CloudWatchLogsClient", "DescribeMetricFiltersCommand")
    .sc(schemas_0.DescribeMetricFilters$)
    .build() {
}

class DescribeQueriesCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeQueries", {})
    .n("CloudWatchLogsClient", "DescribeQueriesCommand")
    .sc(schemas_0.DescribeQueries$)
    .build() {
}

class DescribeQueryDefinitionsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeQueryDefinitions", {})
    .n("CloudWatchLogsClient", "DescribeQueryDefinitionsCommand")
    .sc(schemas_0.DescribeQueryDefinitions$)
    .build() {
}

class DescribeResourcePoliciesCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeResourcePolicies", {})
    .n("CloudWatchLogsClient", "DescribeResourcePoliciesCommand")
    .sc(schemas_0.DescribeResourcePolicies$)
    .build() {
}

class DescribeSubscriptionFiltersCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DescribeSubscriptionFilters", {})
    .n("CloudWatchLogsClient", "DescribeSubscriptionFiltersCommand")
    .sc(schemas_0.DescribeSubscriptionFilters$)
    .build() {
}

class DisassociateKmsKeyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DisassociateKmsKey", {})
    .n("CloudWatchLogsClient", "DisassociateKmsKeyCommand")
    .sc(schemas_0.DisassociateKmsKey$)
    .build() {
}

class DisassociateSourceFromS3TableIntegrationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "DisassociateSourceFromS3TableIntegration", {})
    .n("CloudWatchLogsClient", "DisassociateSourceFromS3TableIntegrationCommand")
    .sc(schemas_0.DisassociateSourceFromS3TableIntegration$)
    .build() {
}

class FilterLogEventsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "FilterLogEvents", {})
    .n("CloudWatchLogsClient", "FilterLogEventsCommand")
    .sc(schemas_0.FilterLogEvents$)
    .build() {
}

class GetDataProtectionPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetDataProtectionPolicy", {})
    .n("CloudWatchLogsClient", "GetDataProtectionPolicyCommand")
    .sc(schemas_0.GetDataProtectionPolicy$)
    .build() {
}

class GetDeliveryCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetDelivery", {})
    .n("CloudWatchLogsClient", "GetDeliveryCommand")
    .sc(schemas_0.GetDelivery$)
    .build() {
}

class GetDeliveryDestinationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetDeliveryDestination", {})
    .n("CloudWatchLogsClient", "GetDeliveryDestinationCommand")
    .sc(schemas_0.GetDeliveryDestination$)
    .build() {
}

class GetDeliveryDestinationPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetDeliveryDestinationPolicy", {})
    .n("CloudWatchLogsClient", "GetDeliveryDestinationPolicyCommand")
    .sc(schemas_0.GetDeliveryDestinationPolicy$)
    .build() {
}

class GetDeliverySourceCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetDeliverySource", {})
    .n("CloudWatchLogsClient", "GetDeliverySourceCommand")
    .sc(schemas_0.GetDeliverySource$)
    .build() {
}

class GetIntegrationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetIntegration", {})
    .n("CloudWatchLogsClient", "GetIntegrationCommand")
    .sc(schemas_0.GetIntegration$)
    .build() {
}

class GetLogAnomalyDetectorCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetLogAnomalyDetector", {})
    .n("CloudWatchLogsClient", "GetLogAnomalyDetectorCommand")
    .sc(schemas_0.GetLogAnomalyDetector$)
    .build() {
}

class GetLogEventsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetLogEvents", {})
    .n("CloudWatchLogsClient", "GetLogEventsCommand")
    .sc(schemas_0.GetLogEvents$)
    .build() {
}

class GetLogFieldsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetLogFields", {})
    .n("CloudWatchLogsClient", "GetLogFieldsCommand")
    .sc(schemas_0.GetLogFields$)
    .build() {
}

class GetLogGroupFieldsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetLogGroupFields", {})
    .n("CloudWatchLogsClient", "GetLogGroupFieldsCommand")
    .sc(schemas_0.GetLogGroupFields$)
    .build() {
}

class GetLogObjectCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetLogObject", {
    eventStream: {
        output: true,
    },
})
    .n("CloudWatchLogsClient", "GetLogObjectCommand")
    .sc(schemas_0.GetLogObject$)
    .build() {
}

class GetLogRecordCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetLogRecord", {})
    .n("CloudWatchLogsClient", "GetLogRecordCommand")
    .sc(schemas_0.GetLogRecord$)
    .build() {
}

class GetQueryResultsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetQueryResults", {})
    .n("CloudWatchLogsClient", "GetQueryResultsCommand")
    .sc(schemas_0.GetQueryResults$)
    .build() {
}

class GetScheduledQueryCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetScheduledQuery", {})
    .n("CloudWatchLogsClient", "GetScheduledQueryCommand")
    .sc(schemas_0.GetScheduledQuery$)
    .build() {
}

class GetScheduledQueryHistoryCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetScheduledQueryHistory", {})
    .n("CloudWatchLogsClient", "GetScheduledQueryHistoryCommand")
    .sc(schemas_0.GetScheduledQueryHistory$)
    .build() {
}

class GetTransformerCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "GetTransformer", {})
    .n("CloudWatchLogsClient", "GetTransformerCommand")
    .sc(schemas_0.GetTransformer$)
    .build() {
}

class ListAggregateLogGroupSummariesCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "ListAggregateLogGroupSummaries", {})
    .n("CloudWatchLogsClient", "ListAggregateLogGroupSummariesCommand")
    .sc(schemas_0.ListAggregateLogGroupSummaries$)
    .build() {
}

class ListAnomaliesCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "ListAnomalies", {})
    .n("CloudWatchLogsClient", "ListAnomaliesCommand")
    .sc(schemas_0.ListAnomalies$)
    .build() {
}

class ListIntegrationsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "ListIntegrations", {})
    .n("CloudWatchLogsClient", "ListIntegrationsCommand")
    .sc(schemas_0.ListIntegrations$)
    .build() {
}

class ListLogAnomalyDetectorsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "ListLogAnomalyDetectors", {})
    .n("CloudWatchLogsClient", "ListLogAnomalyDetectorsCommand")
    .sc(schemas_0.ListLogAnomalyDetectors$)
    .build() {
}

class ListLogGroupsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "ListLogGroups", {})
    .n("CloudWatchLogsClient", "ListLogGroupsCommand")
    .sc(schemas_0.ListLogGroups$)
    .build() {
}

class ListLogGroupsForQueryCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "ListLogGroupsForQuery", {})
    .n("CloudWatchLogsClient", "ListLogGroupsForQueryCommand")
    .sc(schemas_0.ListLogGroupsForQuery$)
    .build() {
}

class ListScheduledQueriesCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "ListScheduledQueries", {})
    .n("CloudWatchLogsClient", "ListScheduledQueriesCommand")
    .sc(schemas_0.ListScheduledQueries$)
    .build() {
}

class ListSourcesForS3TableIntegrationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "ListSourcesForS3TableIntegration", {})
    .n("CloudWatchLogsClient", "ListSourcesForS3TableIntegrationCommand")
    .sc(schemas_0.ListSourcesForS3TableIntegration$)
    .build() {
}

class ListTagsForResourceCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "ListTagsForResource", {})
    .n("CloudWatchLogsClient", "ListTagsForResourceCommand")
    .sc(schemas_0.ListTagsForResource$)
    .build() {
}

class ListTagsLogGroupCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "ListTagsLogGroup", {})
    .n("CloudWatchLogsClient", "ListTagsLogGroupCommand")
    .sc(schemas_0.ListTagsLogGroup$)
    .build() {
}

class PutAccountPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutAccountPolicy", {})
    .n("CloudWatchLogsClient", "PutAccountPolicyCommand")
    .sc(schemas_0.PutAccountPolicy$)
    .build() {
}

class PutBearerTokenAuthenticationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutBearerTokenAuthentication", {})
    .n("CloudWatchLogsClient", "PutBearerTokenAuthenticationCommand")
    .sc(schemas_0.PutBearerTokenAuthentication$)
    .build() {
}

class PutDataProtectionPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutDataProtectionPolicy", {})
    .n("CloudWatchLogsClient", "PutDataProtectionPolicyCommand")
    .sc(schemas_0.PutDataProtectionPolicy$)
    .build() {
}

class PutDeliveryDestinationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutDeliveryDestination", {})
    .n("CloudWatchLogsClient", "PutDeliveryDestinationCommand")
    .sc(schemas_0.PutDeliveryDestination$)
    .build() {
}

class PutDeliveryDestinationPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutDeliveryDestinationPolicy", {})
    .n("CloudWatchLogsClient", "PutDeliveryDestinationPolicyCommand")
    .sc(schemas_0.PutDeliveryDestinationPolicy$)
    .build() {
}

class PutDeliverySourceCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutDeliverySource", {})
    .n("CloudWatchLogsClient", "PutDeliverySourceCommand")
    .sc(schemas_0.PutDeliverySource$)
    .build() {
}

class PutDestinationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutDestination", {})
    .n("CloudWatchLogsClient", "PutDestinationCommand")
    .sc(schemas_0.PutDestination$)
    .build() {
}

class PutDestinationPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutDestinationPolicy", {})
    .n("CloudWatchLogsClient", "PutDestinationPolicyCommand")
    .sc(schemas_0.PutDestinationPolicy$)
    .build() {
}

class PutIndexPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutIndexPolicy", {})
    .n("CloudWatchLogsClient", "PutIndexPolicyCommand")
    .sc(schemas_0.PutIndexPolicy$)
    .build() {
}

class PutIntegrationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutIntegration", {})
    .n("CloudWatchLogsClient", "PutIntegrationCommand")
    .sc(schemas_0.PutIntegration$)
    .build() {
}

class PutLogEventsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutLogEvents", {})
    .n("CloudWatchLogsClient", "PutLogEventsCommand")
    .sc(schemas_0.PutLogEvents$)
    .build() {
}

class PutLogGroupDeletionProtectionCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutLogGroupDeletionProtection", {})
    .n("CloudWatchLogsClient", "PutLogGroupDeletionProtectionCommand")
    .sc(schemas_0.PutLogGroupDeletionProtection$)
    .build() {
}

class PutMetricFilterCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutMetricFilter", {})
    .n("CloudWatchLogsClient", "PutMetricFilterCommand")
    .sc(schemas_0.PutMetricFilter$)
    .build() {
}

class PutQueryDefinitionCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutQueryDefinition", {})
    .n("CloudWatchLogsClient", "PutQueryDefinitionCommand")
    .sc(schemas_0.PutQueryDefinition$)
    .build() {
}

class PutResourcePolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutResourcePolicy", {})
    .n("CloudWatchLogsClient", "PutResourcePolicyCommand")
    .sc(schemas_0.PutResourcePolicy$)
    .build() {
}

class PutRetentionPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutRetentionPolicy", {})
    .n("CloudWatchLogsClient", "PutRetentionPolicyCommand")
    .sc(schemas_0.PutRetentionPolicy$)
    .build() {
}

class PutSubscriptionFilterCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutSubscriptionFilter", {})
    .n("CloudWatchLogsClient", "PutSubscriptionFilterCommand")
    .sc(schemas_0.PutSubscriptionFilter$)
    .build() {
}

class PutTransformerCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "PutTransformer", {})
    .n("CloudWatchLogsClient", "PutTransformerCommand")
    .sc(schemas_0.PutTransformer$)
    .build() {
}

class StartLiveTailCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "StartLiveTail", {
    eventStream: {
        output: true,
    },
})
    .n("CloudWatchLogsClient", "StartLiveTailCommand")
    .sc(schemas_0.StartLiveTail$)
    .build() {
}

class StartQueryCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "StartQuery", {})
    .n("CloudWatchLogsClient", "StartQueryCommand")
    .sc(schemas_0.StartQuery$)
    .build() {
}

class StopQueryCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "StopQuery", {})
    .n("CloudWatchLogsClient", "StopQueryCommand")
    .sc(schemas_0.StopQuery$)
    .build() {
}

class TagLogGroupCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "TagLogGroup", {})
    .n("CloudWatchLogsClient", "TagLogGroupCommand")
    .sc(schemas_0.TagLogGroup$)
    .build() {
}

class TagResourceCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "TagResource", {})
    .n("CloudWatchLogsClient", "TagResourceCommand")
    .sc(schemas_0.TagResource$)
    .build() {
}

class TestMetricFilterCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "TestMetricFilter", {})
    .n("CloudWatchLogsClient", "TestMetricFilterCommand")
    .sc(schemas_0.TestMetricFilter$)
    .build() {
}

class TestTransformerCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "TestTransformer", {})
    .n("CloudWatchLogsClient", "TestTransformerCommand")
    .sc(schemas_0.TestTransformer$)
    .build() {
}

class UntagLogGroupCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "UntagLogGroup", {})
    .n("CloudWatchLogsClient", "UntagLogGroupCommand")
    .sc(schemas_0.UntagLogGroup$)
    .build() {
}

class UntagResourceCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "UntagResource", {})
    .n("CloudWatchLogsClient", "UntagResourceCommand")
    .sc(schemas_0.UntagResource$)
    .build() {
}

class UpdateAnomalyCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "UpdateAnomaly", {})
    .n("CloudWatchLogsClient", "UpdateAnomalyCommand")
    .sc(schemas_0.UpdateAnomaly$)
    .build() {
}

class UpdateDeliveryConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "UpdateDeliveryConfiguration", {})
    .n("CloudWatchLogsClient", "UpdateDeliveryConfigurationCommand")
    .sc(schemas_0.UpdateDeliveryConfiguration$)
    .build() {
}

class UpdateLogAnomalyDetectorCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "UpdateLogAnomalyDetector", {})
    .n("CloudWatchLogsClient", "UpdateLogAnomalyDetectorCommand")
    .sc(schemas_0.UpdateLogAnomalyDetector$)
    .build() {
}

class UpdateScheduledQueryCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("Logs_20140328", "UpdateScheduledQuery", {})
    .n("CloudWatchLogsClient", "UpdateScheduledQueryCommand")
    .sc(schemas_0.UpdateScheduledQuery$)
    .build() {
}

const paginateDescribeConfigurationTemplates = core.createPaginator(CloudWatchLogsClient, DescribeConfigurationTemplatesCommand, "nextToken", "nextToken", "limit");

const paginateDescribeDeliveries = core.createPaginator(CloudWatchLogsClient, DescribeDeliveriesCommand, "nextToken", "nextToken", "limit");

const paginateDescribeDeliveryDestinations = core.createPaginator(CloudWatchLogsClient, DescribeDeliveryDestinationsCommand, "nextToken", "nextToken", "limit");

const paginateDescribeDeliverySources = core.createPaginator(CloudWatchLogsClient, DescribeDeliverySourcesCommand, "nextToken", "nextToken", "limit");

const paginateDescribeDestinations = core.createPaginator(CloudWatchLogsClient, DescribeDestinationsCommand, "nextToken", "nextToken", "limit");

const paginateDescribeLogGroups = core.createPaginator(CloudWatchLogsClient, DescribeLogGroupsCommand, "nextToken", "nextToken", "limit");

const paginateDescribeLogStreams = core.createPaginator(CloudWatchLogsClient, DescribeLogStreamsCommand, "nextToken", "nextToken", "limit");

const paginateDescribeMetricFilters = core.createPaginator(CloudWatchLogsClient, DescribeMetricFiltersCommand, "nextToken", "nextToken", "limit");

const paginateDescribeSubscriptionFilters = core.createPaginator(CloudWatchLogsClient, DescribeSubscriptionFiltersCommand, "nextToken", "nextToken", "limit");

const paginateFilterLogEvents = core.createPaginator(CloudWatchLogsClient, FilterLogEventsCommand, "nextToken", "nextToken", "limit");

const paginateGetLogEvents = core.createPaginator(CloudWatchLogsClient, GetLogEventsCommand, "nextToken", "nextForwardToken", "limit");

const paginateGetScheduledQueryHistory = core.createPaginator(CloudWatchLogsClient, GetScheduledQueryHistoryCommand, "nextToken", "nextToken", "maxResults");

const paginateListAggregateLogGroupSummaries = core.createPaginator(CloudWatchLogsClient, ListAggregateLogGroupSummariesCommand, "nextToken", "nextToken", "limit");

const paginateListAnomalies = core.createPaginator(CloudWatchLogsClient, ListAnomaliesCommand, "nextToken", "nextToken", "limit");

const paginateListLogAnomalyDetectors = core.createPaginator(CloudWatchLogsClient, ListLogAnomalyDetectorsCommand, "nextToken", "nextToken", "limit");

const paginateListLogGroupsForQuery = core.createPaginator(CloudWatchLogsClient, ListLogGroupsForQueryCommand, "nextToken", "nextToken", "maxResults");

const paginateListScheduledQueries = core.createPaginator(CloudWatchLogsClient, ListScheduledQueriesCommand, "nextToken", "nextToken", "maxResults");

const paginateListSourcesForS3TableIntegration = core.createPaginator(CloudWatchLogsClient, ListSourcesForS3TableIntegrationCommand, "nextToken", "nextToken", "maxResults");

const commands = {
    AssociateKmsKeyCommand,
    AssociateSourceToS3TableIntegrationCommand,
    CancelExportTaskCommand,
    CancelImportTaskCommand,
    CreateDeliveryCommand,
    CreateExportTaskCommand,
    CreateImportTaskCommand,
    CreateLogAnomalyDetectorCommand,
    CreateLogGroupCommand,
    CreateLogStreamCommand,
    CreateScheduledQueryCommand,
    DeleteAccountPolicyCommand,
    DeleteDataProtectionPolicyCommand,
    DeleteDeliveryCommand,
    DeleteDeliveryDestinationCommand,
    DeleteDeliveryDestinationPolicyCommand,
    DeleteDeliverySourceCommand,
    DeleteDestinationCommand,
    DeleteIndexPolicyCommand,
    DeleteIntegrationCommand,
    DeleteLogAnomalyDetectorCommand,
    DeleteLogGroupCommand,
    DeleteLogStreamCommand,
    DeleteMetricFilterCommand,
    DeleteQueryDefinitionCommand,
    DeleteResourcePolicyCommand,
    DeleteRetentionPolicyCommand,
    DeleteScheduledQueryCommand,
    DeleteSubscriptionFilterCommand,
    DeleteTransformerCommand,
    DescribeAccountPoliciesCommand,
    DescribeConfigurationTemplatesCommand,
    DescribeDeliveriesCommand,
    DescribeDeliveryDestinationsCommand,
    DescribeDeliverySourcesCommand,
    DescribeDestinationsCommand,
    DescribeExportTasksCommand,
    DescribeFieldIndexesCommand,
    DescribeImportTaskBatchesCommand,
    DescribeImportTasksCommand,
    DescribeIndexPoliciesCommand,
    DescribeLogGroupsCommand,
    DescribeLogStreamsCommand,
    DescribeMetricFiltersCommand,
    DescribeQueriesCommand,
    DescribeQueryDefinitionsCommand,
    DescribeResourcePoliciesCommand,
    DescribeSubscriptionFiltersCommand,
    DisassociateKmsKeyCommand,
    DisassociateSourceFromS3TableIntegrationCommand,
    FilterLogEventsCommand,
    GetDataProtectionPolicyCommand,
    GetDeliveryCommand,
    GetDeliveryDestinationCommand,
    GetDeliveryDestinationPolicyCommand,
    GetDeliverySourceCommand,
    GetIntegrationCommand,
    GetLogAnomalyDetectorCommand,
    GetLogEventsCommand,
    GetLogFieldsCommand,
    GetLogGroupFieldsCommand,
    GetLogObjectCommand,
    GetLogRecordCommand,
    GetQueryResultsCommand,
    GetScheduledQueryCommand,
    GetScheduledQueryHistoryCommand,
    GetTransformerCommand,
    ListAggregateLogGroupSummariesCommand,
    ListAnomaliesCommand,
    ListIntegrationsCommand,
    ListLogAnomalyDetectorsCommand,
    ListLogGroupsCommand,
    ListLogGroupsForQueryCommand,
    ListScheduledQueriesCommand,
    ListSourcesForS3TableIntegrationCommand,
    ListTagsForResourceCommand,
    ListTagsLogGroupCommand,
    PutAccountPolicyCommand,
    PutBearerTokenAuthenticationCommand,
    PutDataProtectionPolicyCommand,
    PutDeliveryDestinationCommand,
    PutDeliveryDestinationPolicyCommand,
    PutDeliverySourceCommand,
    PutDestinationCommand,
    PutDestinationPolicyCommand,
    PutIndexPolicyCommand,
    PutIntegrationCommand,
    PutLogEventsCommand,
    PutLogGroupDeletionProtectionCommand,
    PutMetricFilterCommand,
    PutQueryDefinitionCommand,
    PutResourcePolicyCommand,
    PutRetentionPolicyCommand,
    PutSubscriptionFilterCommand,
    PutTransformerCommand,
    StartLiveTailCommand,
    StartQueryCommand,
    StopQueryCommand,
    TagLogGroupCommand,
    TagResourceCommand,
    TestMetricFilterCommand,
    TestTransformerCommand,
    UntagLogGroupCommand,
    UntagResourceCommand,
    UpdateAnomalyCommand,
    UpdateDeliveryConfigurationCommand,
    UpdateLogAnomalyDetectorCommand,
    UpdateScheduledQueryCommand,
};
const paginators = {
    paginateDescribeConfigurationTemplates,
    paginateDescribeDeliveries,
    paginateDescribeDeliveryDestinations,
    paginateDescribeDeliverySources,
    paginateDescribeDestinations,
    paginateDescribeLogGroups,
    paginateDescribeLogStreams,
    paginateDescribeMetricFilters,
    paginateDescribeSubscriptionFilters,
    paginateFilterLogEvents,
    paginateGetLogEvents,
    paginateGetScheduledQueryHistory,
    paginateListAggregateLogGroupSummaries,
    paginateListAnomalies,
    paginateListLogAnomalyDetectors,
    paginateListLogGroupsForQuery,
    paginateListScheduledQueries,
    paginateListSourcesForS3TableIntegration,
};
class CloudWatchLogs extends CloudWatchLogsClient {
}
smithyClient.createAggregatedClient(commands, CloudWatchLogs, { paginators });

const PolicyType = {
    DATA_PROTECTION_POLICY: "DATA_PROTECTION_POLICY",
    FIELD_INDEX_POLICY: "FIELD_INDEX_POLICY",
    METRIC_EXTRACTION_POLICY: "METRIC_EXTRACTION_POLICY",
    SUBSCRIPTION_FILTER_POLICY: "SUBSCRIPTION_FILTER_POLICY",
    TRANSFORMER_POLICY: "TRANSFORMER_POLICY",
};
const Scope = {
    ALL: "ALL",
};
const ActionStatus = {
    CLIENT_ERROR: "CLIENT_ERROR",
    COMPLETE: "COMPLETE",
    FAILED: "FAILED",
    IN_PROGRESS: "IN_PROGRESS",
};
const State = {
    Active: "Active",
    Baseline: "Baseline",
    Suppressed: "Suppressed",
};
const AnomalyDetectorStatus = {
    ANALYZING: "ANALYZING",
    DELETED: "DELETED",
    FAILED: "FAILED",
    INITIALIZING: "INITIALIZING",
    PAUSED: "PAUSED",
    TRAINING: "TRAINING",
};
const EvaluationFrequency = {
    FIFTEEN_MIN: "FIFTEEN_MIN",
    FIVE_MIN: "FIVE_MIN",
    ONE_HOUR: "ONE_HOUR",
    ONE_MIN: "ONE_MIN",
    TEN_MIN: "TEN_MIN",
    THIRTY_MIN: "THIRTY_MIN",
};
const ImportStatus = {
    CANCELLED: "CANCELLED",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    IN_PROGRESS: "IN_PROGRESS",
};
const OutputFormat = {
    JSON: "json",
    PARQUET: "parquet",
    PLAIN: "plain",
    RAW: "raw",
    W3C: "w3c",
};
const DeliveryDestinationType = {
    CWL: "CWL",
    FH: "FH",
    S3: "S3",
    XRAY: "XRAY",
};
const LogGroupClass = {
    DELIVERY: "DELIVERY",
    INFREQUENT_ACCESS: "INFREQUENT_ACCESS",
    STANDARD: "STANDARD",
};
const QueryLanguage = {
    CWLI: "CWLI",
    PPL: "PPL",
    SQL: "SQL",
};
const ScheduledQueryState = {
    DISABLED: "DISABLED",
    ENABLED: "ENABLED",
};
const DataProtectionStatus = {
    ACTIVATED: "ACTIVATED",
    ARCHIVED: "ARCHIVED",
    DELETED: "DELETED",
    DISABLED: "DISABLED",
};
const ExportTaskStatusCode = {
    CANCELLED: "CANCELLED",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    PENDING: "PENDING",
    PENDING_CANCEL: "PENDING_CANCEL",
    RUNNING: "RUNNING",
};
const IndexType = {
    FACET: "FACET",
    FIELD_INDEX: "FIELD_INDEX",
};
const IndexSource = {
    ACCOUNT: "ACCOUNT",
    LOG_GROUP: "LOG_GROUP",
};
const InheritedProperty = {
    ACCOUNT_DATA_PROTECTION: "ACCOUNT_DATA_PROTECTION",
};
const OrderBy = {
    LastEventTime: "LastEventTime",
    LogStreamName: "LogStreamName",
};
const StandardUnit = {
    Bits: "Bits",
    BitsSecond: "Bits/Second",
    Bytes: "Bytes",
    BytesSecond: "Bytes/Second",
    Count: "Count",
    CountSecond: "Count/Second",
    Gigabits: "Gigabits",
    GigabitsSecond: "Gigabits/Second",
    Gigabytes: "Gigabytes",
    GigabytesSecond: "Gigabytes/Second",
    Kilobits: "Kilobits",
    KilobitsSecond: "Kilobits/Second",
    Kilobytes: "Kilobytes",
    KilobytesSecond: "Kilobytes/Second",
    Megabits: "Megabits",
    MegabitsSecond: "Megabits/Second",
    Megabytes: "Megabytes",
    MegabytesSecond: "Megabytes/Second",
    Microseconds: "Microseconds",
    Milliseconds: "Milliseconds",
    None: "None",
    Percent: "Percent",
    Seconds: "Seconds",
    Terabits: "Terabits",
    TerabitsSecond: "Terabits/Second",
    Terabytes: "Terabytes",
    TerabytesSecond: "Terabytes/Second",
};
const QueryStatus = {
    Cancelled: "Cancelled",
    Complete: "Complete",
    Failed: "Failed",
    Running: "Running",
    Scheduled: "Scheduled",
    Timeout: "Timeout",
    Unknown: "Unknown",
};
const PolicyScope = {
    ACCOUNT: "ACCOUNT",
    RESOURCE: "RESOURCE",
};
const Distribution = {
    ByLogStream: "ByLogStream",
    Random: "Random",
};
const EntityRejectionErrorType = {
    ENTITY_SIZE_TOO_LARGE: "EntitySizeTooLarge",
    INVALID_ATTRIBUTES: "InvalidAttributes",
    INVALID_ENTITY: "InvalidEntity",
    INVALID_KEY_ATTRIBUTE: "InvalidKeyAttributes",
    INVALID_TYPE_VALUE: "InvalidTypeValue",
    MISSING_REQUIRED_FIELDS: "MissingRequiredFields",
    UNSUPPORTED_LOG_GROUP_TYPE: "UnsupportedLogGroupType",
};
const EventSource = {
    AWSWAF: "AWSWAF",
    CLOUD_TRAIL: "CloudTrail",
    EKS_AUDIT: "EKSAudit",
    ROUTE53_RESOLVER: "Route53Resolver",
    VPC_FLOW: "VPCFlow",
};
const ExecutionStatus = {
    Complete: "Complete",
    Failed: "Failed",
    InvalidQuery: "InvalidQuery",
    Running: "Running",
    Timeout: "Timeout",
};
const FlattenedElement = {
    FIRST: "first",
    LAST: "last",
};
const OpenSearchResourceStatusType = {
    ACTIVE: "ACTIVE",
    ERROR: "ERROR",
    NOT_FOUND: "NOT_FOUND",
};
const IntegrationStatus = {
    ACTIVE: "ACTIVE",
    FAILED: "FAILED",
    PROVISIONING: "PROVISIONING",
};
const IntegrationType = {
    OPENSEARCH: "OPENSEARCH",
};
const ScheduledQueryDestinationType = {
    S3: "S3",
};
const OCSFVersion = {
    V1_1: "V1.1",
    V1_5: "V1.5",
};
const Type = {
    BOOLEAN: "boolean",
    DOUBLE: "double",
    INTEGER: "integer",
    STRING: "string",
};
const ListAggregateLogGroupSummariesGroupBy = {
    DATA_SOURCE_NAME_AND_TYPE: "DATA_SOURCE_NAME_AND_TYPE",
    DATA_SOURCE_NAME_TYPE_AND_FORMAT: "DATA_SOURCE_NAME_TYPE_AND_FORMAT",
};
const SuppressionState = {
    SUPPRESSED: "SUPPRESSED",
    UNSUPPRESSED: "UNSUPPRESSED",
};
const S3TableIntegrationSourceStatus = {
    ACTIVE: "ACTIVE",
    DATA_SOURCE_DELETE_IN_PROGRESS: "DATA_SOURCE_DELETE_IN_PROGRESS",
    FAILED: "FAILED",
    UNHEALTHY: "UNHEALTHY",
};
const SuppressionUnit = {
    HOURS: "HOURS",
    MINUTES: "MINUTES",
    SECONDS: "SECONDS",
};
const SuppressionType = {
    INFINITE: "INFINITE",
    LIMITED: "LIMITED",
};

exports.$Command = smithyClient.Command;
exports.__Client = smithyClient.Client;
exports.CloudWatchLogsServiceException = CloudWatchLogsServiceException.CloudWatchLogsServiceException;
exports.ActionStatus = ActionStatus;
exports.AnomalyDetectorStatus = AnomalyDetectorStatus;
exports.AssociateKmsKeyCommand = AssociateKmsKeyCommand;
exports.AssociateSourceToS3TableIntegrationCommand = AssociateSourceToS3TableIntegrationCommand;
exports.CancelExportTaskCommand = CancelExportTaskCommand;
exports.CancelImportTaskCommand = CancelImportTaskCommand;
exports.CloudWatchLogs = CloudWatchLogs;
exports.CloudWatchLogsClient = CloudWatchLogsClient;
exports.CreateDeliveryCommand = CreateDeliveryCommand;
exports.CreateExportTaskCommand = CreateExportTaskCommand;
exports.CreateImportTaskCommand = CreateImportTaskCommand;
exports.CreateLogAnomalyDetectorCommand = CreateLogAnomalyDetectorCommand;
exports.CreateLogGroupCommand = CreateLogGroupCommand;
exports.CreateLogStreamCommand = CreateLogStreamCommand;
exports.CreateScheduledQueryCommand = CreateScheduledQueryCommand;
exports.DataProtectionStatus = DataProtectionStatus;
exports.DeleteAccountPolicyCommand = DeleteAccountPolicyCommand;
exports.DeleteDataProtectionPolicyCommand = DeleteDataProtectionPolicyCommand;
exports.DeleteDeliveryCommand = DeleteDeliveryCommand;
exports.DeleteDeliveryDestinationCommand = DeleteDeliveryDestinationCommand;
exports.DeleteDeliveryDestinationPolicyCommand = DeleteDeliveryDestinationPolicyCommand;
exports.DeleteDeliverySourceCommand = DeleteDeliverySourceCommand;
exports.DeleteDestinationCommand = DeleteDestinationCommand;
exports.DeleteIndexPolicyCommand = DeleteIndexPolicyCommand;
exports.DeleteIntegrationCommand = DeleteIntegrationCommand;
exports.DeleteLogAnomalyDetectorCommand = DeleteLogAnomalyDetectorCommand;
exports.DeleteLogGroupCommand = DeleteLogGroupCommand;
exports.DeleteLogStreamCommand = DeleteLogStreamCommand;
exports.DeleteMetricFilterCommand = DeleteMetricFilterCommand;
exports.DeleteQueryDefinitionCommand = DeleteQueryDefinitionCommand;
exports.DeleteResourcePolicyCommand = DeleteResourcePolicyCommand;
exports.DeleteRetentionPolicyCommand = DeleteRetentionPolicyCommand;
exports.DeleteScheduledQueryCommand = DeleteScheduledQueryCommand;
exports.DeleteSubscriptionFilterCommand = DeleteSubscriptionFilterCommand;
exports.DeleteTransformerCommand = DeleteTransformerCommand;
exports.DeliveryDestinationType = DeliveryDestinationType;
exports.DescribeAccountPoliciesCommand = DescribeAccountPoliciesCommand;
exports.DescribeConfigurationTemplatesCommand = DescribeConfigurationTemplatesCommand;
exports.DescribeDeliveriesCommand = DescribeDeliveriesCommand;
exports.DescribeDeliveryDestinationsCommand = DescribeDeliveryDestinationsCommand;
exports.DescribeDeliverySourcesCommand = DescribeDeliverySourcesCommand;
exports.DescribeDestinationsCommand = DescribeDestinationsCommand;
exports.DescribeExportTasksCommand = DescribeExportTasksCommand;
exports.DescribeFieldIndexesCommand = DescribeFieldIndexesCommand;
exports.DescribeImportTaskBatchesCommand = DescribeImportTaskBatchesCommand;
exports.DescribeImportTasksCommand = DescribeImportTasksCommand;
exports.DescribeIndexPoliciesCommand = DescribeIndexPoliciesCommand;
exports.DescribeLogGroupsCommand = DescribeLogGroupsCommand;
exports.DescribeLogStreamsCommand = DescribeLogStreamsCommand;
exports.DescribeMetricFiltersCommand = DescribeMetricFiltersCommand;
exports.DescribeQueriesCommand = DescribeQueriesCommand;
exports.DescribeQueryDefinitionsCommand = DescribeQueryDefinitionsCommand;
exports.DescribeResourcePoliciesCommand = DescribeResourcePoliciesCommand;
exports.DescribeSubscriptionFiltersCommand = DescribeSubscriptionFiltersCommand;
exports.DisassociateKmsKeyCommand = DisassociateKmsKeyCommand;
exports.DisassociateSourceFromS3TableIntegrationCommand = DisassociateSourceFromS3TableIntegrationCommand;
exports.Distribution = Distribution;
exports.EntityRejectionErrorType = EntityRejectionErrorType;
exports.EvaluationFrequency = EvaluationFrequency;
exports.EventSource = EventSource;
exports.ExecutionStatus = ExecutionStatus;
exports.ExportTaskStatusCode = ExportTaskStatusCode;
exports.FilterLogEventsCommand = FilterLogEventsCommand;
exports.FlattenedElement = FlattenedElement;
exports.GetDataProtectionPolicyCommand = GetDataProtectionPolicyCommand;
exports.GetDeliveryCommand = GetDeliveryCommand;
exports.GetDeliveryDestinationCommand = GetDeliveryDestinationCommand;
exports.GetDeliveryDestinationPolicyCommand = GetDeliveryDestinationPolicyCommand;
exports.GetDeliverySourceCommand = GetDeliverySourceCommand;
exports.GetIntegrationCommand = GetIntegrationCommand;
exports.GetLogAnomalyDetectorCommand = GetLogAnomalyDetectorCommand;
exports.GetLogEventsCommand = GetLogEventsCommand;
exports.GetLogFieldsCommand = GetLogFieldsCommand;
exports.GetLogGroupFieldsCommand = GetLogGroupFieldsCommand;
exports.GetLogObjectCommand = GetLogObjectCommand;
exports.GetLogRecordCommand = GetLogRecordCommand;
exports.GetQueryResultsCommand = GetQueryResultsCommand;
exports.GetScheduledQueryCommand = GetScheduledQueryCommand;
exports.GetScheduledQueryHistoryCommand = GetScheduledQueryHistoryCommand;
exports.GetTransformerCommand = GetTransformerCommand;
exports.ImportStatus = ImportStatus;
exports.IndexSource = IndexSource;
exports.IndexType = IndexType;
exports.InheritedProperty = InheritedProperty;
exports.IntegrationStatus = IntegrationStatus;
exports.IntegrationType = IntegrationType;
exports.ListAggregateLogGroupSummariesCommand = ListAggregateLogGroupSummariesCommand;
exports.ListAggregateLogGroupSummariesGroupBy = ListAggregateLogGroupSummariesGroupBy;
exports.ListAnomaliesCommand = ListAnomaliesCommand;
exports.ListIntegrationsCommand = ListIntegrationsCommand;
exports.ListLogAnomalyDetectorsCommand = ListLogAnomalyDetectorsCommand;
exports.ListLogGroupsCommand = ListLogGroupsCommand;
exports.ListLogGroupsForQueryCommand = ListLogGroupsForQueryCommand;
exports.ListScheduledQueriesCommand = ListScheduledQueriesCommand;
exports.ListSourcesForS3TableIntegrationCommand = ListSourcesForS3TableIntegrationCommand;
exports.ListTagsForResourceCommand = ListTagsForResourceCommand;
exports.ListTagsLogGroupCommand = ListTagsLogGroupCommand;
exports.LogGroupClass = LogGroupClass;
exports.OCSFVersion = OCSFVersion;
exports.OpenSearchResourceStatusType = OpenSearchResourceStatusType;
exports.OrderBy = OrderBy;
exports.OutputFormat = OutputFormat;
exports.PolicyScope = PolicyScope;
exports.PolicyType = PolicyType;
exports.PutAccountPolicyCommand = PutAccountPolicyCommand;
exports.PutBearerTokenAuthenticationCommand = PutBearerTokenAuthenticationCommand;
exports.PutDataProtectionPolicyCommand = PutDataProtectionPolicyCommand;
exports.PutDeliveryDestinationCommand = PutDeliveryDestinationCommand;
exports.PutDeliveryDestinationPolicyCommand = PutDeliveryDestinationPolicyCommand;
exports.PutDeliverySourceCommand = PutDeliverySourceCommand;
exports.PutDestinationCommand = PutDestinationCommand;
exports.PutDestinationPolicyCommand = PutDestinationPolicyCommand;
exports.PutIndexPolicyCommand = PutIndexPolicyCommand;
exports.PutIntegrationCommand = PutIntegrationCommand;
exports.PutLogEventsCommand = PutLogEventsCommand;
exports.PutLogGroupDeletionProtectionCommand = PutLogGroupDeletionProtectionCommand;
exports.PutMetricFilterCommand = PutMetricFilterCommand;
exports.PutQueryDefinitionCommand = PutQueryDefinitionCommand;
exports.PutResourcePolicyCommand = PutResourcePolicyCommand;
exports.PutRetentionPolicyCommand = PutRetentionPolicyCommand;
exports.PutSubscriptionFilterCommand = PutSubscriptionFilterCommand;
exports.PutTransformerCommand = PutTransformerCommand;
exports.QueryLanguage = QueryLanguage;
exports.QueryStatus = QueryStatus;
exports.S3TableIntegrationSourceStatus = S3TableIntegrationSourceStatus;
exports.ScheduledQueryDestinationType = ScheduledQueryDestinationType;
exports.ScheduledQueryState = ScheduledQueryState;
exports.Scope = Scope;
exports.StandardUnit = StandardUnit;
exports.StartLiveTailCommand = StartLiveTailCommand;
exports.StartQueryCommand = StartQueryCommand;
exports.State = State;
exports.StopQueryCommand = StopQueryCommand;
exports.SuppressionState = SuppressionState;
exports.SuppressionType = SuppressionType;
exports.SuppressionUnit = SuppressionUnit;
exports.TagLogGroupCommand = TagLogGroupCommand;
exports.TagResourceCommand = TagResourceCommand;
exports.TestMetricFilterCommand = TestMetricFilterCommand;
exports.TestTransformerCommand = TestTransformerCommand;
exports.Type = Type;
exports.UntagLogGroupCommand = UntagLogGroupCommand;
exports.UntagResourceCommand = UntagResourceCommand;
exports.UpdateAnomalyCommand = UpdateAnomalyCommand;
exports.UpdateDeliveryConfigurationCommand = UpdateDeliveryConfigurationCommand;
exports.UpdateLogAnomalyDetectorCommand = UpdateLogAnomalyDetectorCommand;
exports.UpdateScheduledQueryCommand = UpdateScheduledQueryCommand;
exports.paginateDescribeConfigurationTemplates = paginateDescribeConfigurationTemplates;
exports.paginateDescribeDeliveries = paginateDescribeDeliveries;
exports.paginateDescribeDeliveryDestinations = paginateDescribeDeliveryDestinations;
exports.paginateDescribeDeliverySources = paginateDescribeDeliverySources;
exports.paginateDescribeDestinations = paginateDescribeDestinations;
exports.paginateDescribeLogGroups = paginateDescribeLogGroups;
exports.paginateDescribeLogStreams = paginateDescribeLogStreams;
exports.paginateDescribeMetricFilters = paginateDescribeMetricFilters;
exports.paginateDescribeSubscriptionFilters = paginateDescribeSubscriptionFilters;
exports.paginateFilterLogEvents = paginateFilterLogEvents;
exports.paginateGetLogEvents = paginateGetLogEvents;
exports.paginateGetScheduledQueryHistory = paginateGetScheduledQueryHistory;
exports.paginateListAggregateLogGroupSummaries = paginateListAggregateLogGroupSummaries;
exports.paginateListAnomalies = paginateListAnomalies;
exports.paginateListLogAnomalyDetectors = paginateListLogAnomalyDetectors;
exports.paginateListLogGroupsForQuery = paginateListLogGroupsForQuery;
exports.paginateListScheduledQueries = paginateListScheduledQueries;
exports.paginateListSourcesForS3TableIntegration = paginateListSourcesForS3TableIntegration;
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

/***/ 37951:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.CloudWatchLogsServiceException = exports.__ServiceException = void 0;
const smithy_client_1 = __webpack_require__(58015);
Object.defineProperty(exports, "__ServiceException", ({ enumerable: true, get: function () { return smithy_client_1.ServiceException; } }));
class CloudWatchLogsServiceException extends smithy_client_1.ServiceException {
    constructor(options) {
        super(options);
        Object.setPrototypeOf(this, CloudWatchLogsServiceException.prototype);
    }
}
exports.CloudWatchLogsServiceException = CloudWatchLogsServiceException;


/***/ }),

/***/ 8691:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.TooManyTagsException = exports.MalformedQueryException = exports.SessionTimeoutException = exports.SessionStreamingException = exports.UnrecognizedClientException = exports.InvalidSequenceTokenException = exports.InternalStreamingException = exports.DataAlreadyAcceptedException = exports.ResourceAlreadyExistsException = exports.LimitExceededException = exports.ServiceQuotaExceededException = exports.ConflictException = exports.InvalidOperationException = exports.ValidationException = exports.ThrottlingException = exports.InternalServerException = exports.ServiceUnavailableException = exports.ResourceNotFoundException = exports.OperationAbortedException = exports.InvalidParameterException = exports.AccessDeniedException = void 0;
const CloudWatchLogsServiceException_1 = __webpack_require__(37951);
class AccessDeniedException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "AccessDeniedException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "AccessDeniedException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, AccessDeniedException.prototype);
    }
}
exports.AccessDeniedException = AccessDeniedException;
class InvalidParameterException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "InvalidParameterException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "InvalidParameterException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InvalidParameterException.prototype);
    }
}
exports.InvalidParameterException = InvalidParameterException;
class OperationAbortedException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "OperationAbortedException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "OperationAbortedException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, OperationAbortedException.prototype);
    }
}
exports.OperationAbortedException = OperationAbortedException;
class ResourceNotFoundException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "ResourceNotFoundException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ResourceNotFoundException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ResourceNotFoundException.prototype);
    }
}
exports.ResourceNotFoundException = ResourceNotFoundException;
class ServiceUnavailableException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "ServiceUnavailableException";
    $fault = "server";
    constructor(opts) {
        super({
            name: "ServiceUnavailableException",
            $fault: "server",
            ...opts,
        });
        Object.setPrototypeOf(this, ServiceUnavailableException.prototype);
    }
}
exports.ServiceUnavailableException = ServiceUnavailableException;
class InternalServerException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "InternalServerException";
    $fault = "server";
    constructor(opts) {
        super({
            name: "InternalServerException",
            $fault: "server",
            ...opts,
        });
        Object.setPrototypeOf(this, InternalServerException.prototype);
    }
}
exports.InternalServerException = InternalServerException;
class ThrottlingException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "ThrottlingException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ThrottlingException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ThrottlingException.prototype);
    }
}
exports.ThrottlingException = ThrottlingException;
class ValidationException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "ValidationException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ValidationException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ValidationException.prototype);
    }
}
exports.ValidationException = ValidationException;
class InvalidOperationException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "InvalidOperationException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "InvalidOperationException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InvalidOperationException.prototype);
    }
}
exports.InvalidOperationException = InvalidOperationException;
class ConflictException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "ConflictException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ConflictException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ConflictException.prototype);
    }
}
exports.ConflictException = ConflictException;
class ServiceQuotaExceededException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "ServiceQuotaExceededException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ServiceQuotaExceededException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ServiceQuotaExceededException.prototype);
    }
}
exports.ServiceQuotaExceededException = ServiceQuotaExceededException;
class LimitExceededException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "LimitExceededException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "LimitExceededException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, LimitExceededException.prototype);
    }
}
exports.LimitExceededException = LimitExceededException;
class ResourceAlreadyExistsException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "ResourceAlreadyExistsException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ResourceAlreadyExistsException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ResourceAlreadyExistsException.prototype);
    }
}
exports.ResourceAlreadyExistsException = ResourceAlreadyExistsException;
class DataAlreadyAcceptedException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "DataAlreadyAcceptedException";
    $fault = "client";
    expectedSequenceToken;
    constructor(opts) {
        super({
            name: "DataAlreadyAcceptedException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, DataAlreadyAcceptedException.prototype);
        this.expectedSequenceToken = opts.expectedSequenceToken;
    }
}
exports.DataAlreadyAcceptedException = DataAlreadyAcceptedException;
class InternalStreamingException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "InternalStreamingException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "InternalStreamingException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InternalStreamingException.prototype);
    }
}
exports.InternalStreamingException = InternalStreamingException;
class InvalidSequenceTokenException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "InvalidSequenceTokenException";
    $fault = "client";
    expectedSequenceToken;
    constructor(opts) {
        super({
            name: "InvalidSequenceTokenException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InvalidSequenceTokenException.prototype);
        this.expectedSequenceToken = opts.expectedSequenceToken;
    }
}
exports.InvalidSequenceTokenException = InvalidSequenceTokenException;
class UnrecognizedClientException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "UnrecognizedClientException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "UnrecognizedClientException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, UnrecognizedClientException.prototype);
    }
}
exports.UnrecognizedClientException = UnrecognizedClientException;
class SessionStreamingException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "SessionStreamingException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "SessionStreamingException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, SessionStreamingException.prototype);
    }
}
exports.SessionStreamingException = SessionStreamingException;
class SessionTimeoutException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "SessionTimeoutException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "SessionTimeoutException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, SessionTimeoutException.prototype);
    }
}
exports.SessionTimeoutException = SessionTimeoutException;
class MalformedQueryException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "MalformedQueryException";
    $fault = "client";
    queryCompileError;
    constructor(opts) {
        super({
            name: "MalformedQueryException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, MalformedQueryException.prototype);
        this.queryCompileError = opts.queryCompileError;
    }
}
exports.MalformedQueryException = MalformedQueryException;
class TooManyTagsException extends CloudWatchLogsServiceException_1.CloudWatchLogsServiceException {
    name = "TooManyTagsException";
    $fault = "client";
    resourceName;
    constructor(opts) {
        super({
            name: "TooManyTagsException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, TooManyTagsException.prototype);
        this.resourceName = opts.resourceName;
    }
}
exports.TooManyTagsException = TooManyTagsException;


/***/ }),

/***/ 48821:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getRuntimeConfig = void 0;
const tslib_1 = __webpack_require__(94176);
const package_json_1 = tslib_1.__importDefault(__webpack_require__(96650));
const core_1 = __webpack_require__(39116);
const credential_provider_node_1 = __webpack_require__(97777);
const util_user_agent_node_1 = __webpack_require__(16388);
const config_resolver_1 = __webpack_require__(93768);
const eventstream_serde_node_1 = __webpack_require__(63246);
const hash_node_1 = __webpack_require__(51296);
const middleware_retry_1 = __webpack_require__(46318);
const node_config_provider_1 = __webpack_require__(71172);
const node_http_handler_1 = __webpack_require__(18771);
const smithy_client_1 = __webpack_require__(58015);
const util_body_length_node_1 = __webpack_require__(68194);
const util_defaults_mode_node_1 = __webpack_require__(17215);
const util_retry_1 = __webpack_require__(54506);
const runtimeConfig_shared_1 = __webpack_require__(65978);
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
        eventStreamSerdeProvider: config?.eventStreamSerdeProvider ?? eventstream_serde_node_1.eventStreamSerdeProvider,
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

/***/ 65978:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getRuntimeConfig = void 0;
const core_1 = __webpack_require__(39116);
const protocols_1 = __webpack_require__(23628);
const smithy_client_1 = __webpack_require__(58015);
const url_parser_1 = __webpack_require__(7834);
const util_base64_1 = __webpack_require__(77245);
const util_utf8_1 = __webpack_require__(76005);
const httpAuthSchemeProvider_1 = __webpack_require__(78044);
const endpointResolver_1 = __webpack_require__(16354);
const schemas_0_1 = __webpack_require__(11639);
const getRuntimeConfig = (config) => {
    return {
        apiVersion: "2014-03-28",
        base64Decoder: config?.base64Decoder ?? util_base64_1.fromBase64,
        base64Encoder: config?.base64Encoder ?? util_base64_1.toBase64,
        disableHostPrefix: config?.disableHostPrefix ?? false,
        endpointProvider: config?.endpointProvider ?? endpointResolver_1.defaultEndpointResolver,
        extensions: config?.extensions ?? [],
        httpAuthSchemeProvider: config?.httpAuthSchemeProvider ?? httpAuthSchemeProvider_1.defaultCloudWatchLogsHttpAuthSchemeProvider,
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
            defaultNamespace: "com.amazonaws.cloudwatchlogs",
            errorTypeRegistries: schemas_0_1.errorTypeRegistries,
            xmlNamespace: "http://monitoring.amazonaws.com/doc/2014-03-28/",
            version: "2014-03-28",
            serviceTarget: "Logs_20140328",
        },
        serviceId: config?.serviceId ?? "CloudWatch Logs",
        urlParser: config?.urlParser ?? url_parser_1.parseUrl,
        utf8Decoder: config?.utf8Decoder ?? util_utf8_1.fromUtf8,
        utf8Encoder: config?.utf8Encoder ?? util_utf8_1.toUtf8,
    };
};
exports.getRuntimeConfig = getRuntimeConfig;


/***/ }),

/***/ 11639:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.CreateScheduledQueryRequest$ = exports.CreateLogStreamRequest$ = exports.CreateLogGroupRequest$ = exports.CreateLogAnomalyDetectorResponse$ = exports.CreateLogAnomalyDetectorRequest$ = exports.CreateImportTaskResponse$ = exports.CreateImportTaskRequest$ = exports.CreateExportTaskResponse$ = exports.CreateExportTaskRequest$ = exports.CreateDeliveryResponse$ = exports.CreateDeliveryRequest$ = exports.CopyValueEntry$ = exports.CopyValue$ = exports.ConfigurationTemplateDeliveryConfigValues$ = exports.ConfigurationTemplate$ = exports.CancelImportTaskResponse$ = exports.CancelImportTaskRequest$ = exports.CancelExportTaskRequest$ = exports.AssociateSourceToS3TableIntegrationResponse$ = exports.AssociateSourceToS3TableIntegrationRequest$ = exports.AssociateKmsKeyRequest$ = exports.AnomalyDetector$ = exports.Anomaly$ = exports.AggregateLogGroupSummary$ = exports.AddKeys$ = exports.AddKeyEntry$ = exports.AccountPolicy$ = exports.errorTypeRegistries = exports.ValidationException$ = exports.UnrecognizedClientException$ = exports.TooManyTagsException$ = exports.ThrottlingException$ = exports.SessionTimeoutException$ = exports.SessionStreamingException$ = exports.ServiceUnavailableException$ = exports.ServiceQuotaExceededException$ = exports.ResourceNotFoundException$ = exports.ResourceAlreadyExistsException$ = exports.OperationAbortedException$ = exports.MalformedQueryException$ = exports.LimitExceededException$ = exports.InvalidSequenceTokenException$ = exports.InvalidParameterException$ = exports.InvalidOperationException$ = exports.InternalStreamingException$ = exports.InternalServerException$ = exports.DataAlreadyAcceptedException$ = exports.ConflictException$ = exports.AccessDeniedException$ = exports.CloudWatchLogsServiceException$ = void 0;
exports.DescribeImportTaskBatchesRequest$ = exports.DescribeFieldIndexesResponse$ = exports.DescribeFieldIndexesRequest$ = exports.DescribeExportTasksResponse$ = exports.DescribeExportTasksRequest$ = exports.DescribeDestinationsResponse$ = exports.DescribeDestinationsRequest$ = exports.DescribeDeliverySourcesResponse$ = exports.DescribeDeliverySourcesRequest$ = exports.DescribeDeliveryDestinationsResponse$ = exports.DescribeDeliveryDestinationsRequest$ = exports.DescribeDeliveriesResponse$ = exports.DescribeDeliveriesRequest$ = exports.DescribeConfigurationTemplatesResponse$ = exports.DescribeConfigurationTemplatesRequest$ = exports.DescribeAccountPoliciesResponse$ = exports.DescribeAccountPoliciesRequest$ = exports.DeliverySource$ = exports.DeliveryDestinationConfiguration$ = exports.DeliveryDestination$ = exports.Delivery$ = exports.DeleteTransformerRequest$ = exports.DeleteSubscriptionFilterRequest$ = exports.DeleteScheduledQueryResponse$ = exports.DeleteScheduledQueryRequest$ = exports.DeleteRetentionPolicyRequest$ = exports.DeleteResourcePolicyRequest$ = exports.DeleteQueryDefinitionResponse$ = exports.DeleteQueryDefinitionRequest$ = exports.DeleteMetricFilterRequest$ = exports.DeleteLogStreamRequest$ = exports.DeleteLogGroupRequest$ = exports.DeleteLogAnomalyDetectorRequest$ = exports.DeleteKeys$ = exports.DeleteIntegrationResponse$ = exports.DeleteIntegrationRequest$ = exports.DeleteIndexPolicyResponse$ = exports.DeleteIndexPolicyRequest$ = exports.DeleteDestinationRequest$ = exports.DeleteDeliverySourceRequest$ = exports.DeleteDeliveryRequest$ = exports.DeleteDeliveryDestinationRequest$ = exports.DeleteDeliveryDestinationPolicyRequest$ = exports.DeleteDataProtectionPolicyRequest$ = exports.DeleteAccountPolicyRequest$ = exports.DateTimeConverter$ = exports.DataSourceFilter$ = exports.DataSource$ = exports.CSV$ = exports.CreateScheduledQueryResponse$ = void 0;
exports.GetLogFieldsRequest$ = exports.GetLogEventsResponse$ = exports.GetLogEventsRequest$ = exports.GetLogAnomalyDetectorResponse$ = exports.GetLogAnomalyDetectorRequest$ = exports.GetIntegrationResponse$ = exports.GetIntegrationRequest$ = exports.GetDeliverySourceResponse$ = exports.GetDeliverySourceRequest$ = exports.GetDeliveryResponse$ = exports.GetDeliveryRequest$ = exports.GetDeliveryDestinationResponse$ = exports.GetDeliveryDestinationRequest$ = exports.GetDeliveryDestinationPolicyResponse$ = exports.GetDeliveryDestinationPolicyRequest$ = exports.GetDataProtectionPolicyResponse$ = exports.GetDataProtectionPolicyRequest$ = exports.FilterLogEventsResponse$ = exports.FilterLogEventsRequest$ = exports.FilteredLogEvent$ = exports.FieldsData$ = exports.FieldIndex$ = exports.ExportTaskStatus$ = exports.ExportTaskExecutionInfo$ = exports.ExportTask$ = exports.Entity$ = exports.DisassociateSourceFromS3TableIntegrationResponse$ = exports.DisassociateSourceFromS3TableIntegrationRequest$ = exports.DisassociateKmsKeyRequest$ = exports.DestinationConfiguration$ = exports.Destination$ = exports.DescribeSubscriptionFiltersResponse$ = exports.DescribeSubscriptionFiltersRequest$ = exports.DescribeResourcePoliciesResponse$ = exports.DescribeResourcePoliciesRequest$ = exports.DescribeQueryDefinitionsResponse$ = exports.DescribeQueryDefinitionsRequest$ = exports.DescribeQueriesResponse$ = exports.DescribeQueriesRequest$ = exports.DescribeMetricFiltersResponse$ = exports.DescribeMetricFiltersRequest$ = exports.DescribeLogStreamsResponse$ = exports.DescribeLogStreamsRequest$ = exports.DescribeLogGroupsResponse$ = exports.DescribeLogGroupsRequest$ = exports.DescribeIndexPoliciesResponse$ = exports.DescribeIndexPoliciesRequest$ = exports.DescribeImportTasksResponse$ = exports.DescribeImportTasksRequest$ = exports.DescribeImportTaskBatchesResponse$ = void 0;
exports.LogEvent$ = exports.LiveTailSessionUpdate$ = exports.LiveTailSessionStart$ = exports.LiveTailSessionMetadata$ = exports.LiveTailSessionLogEvent$ = exports.ListToMap$ = exports.ListTagsLogGroupResponse$ = exports.ListTagsLogGroupRequest$ = exports.ListTagsForResourceResponse$ = exports.ListTagsForResourceRequest$ = exports.ListSourcesForS3TableIntegrationResponse$ = exports.ListSourcesForS3TableIntegrationRequest$ = exports.ListScheduledQueriesResponse$ = exports.ListScheduledQueriesRequest$ = exports.ListLogGroupsResponse$ = exports.ListLogGroupsRequest$ = exports.ListLogGroupsForQueryResponse$ = exports.ListLogGroupsForQueryRequest$ = exports.ListLogAnomalyDetectorsResponse$ = exports.ListLogAnomalyDetectorsRequest$ = exports.ListIntegrationsResponse$ = exports.ListIntegrationsRequest$ = exports.ListAnomaliesResponse$ = exports.ListAnomaliesRequest$ = exports.ListAggregateLogGroupSummariesResponse$ = exports.ListAggregateLogGroupSummariesRequest$ = exports.IntegrationSummary$ = exports.InputLogEvent$ = exports.IndexPolicy$ = exports.ImportStatistics$ = exports.ImportFilter$ = exports.ImportBatch$ = exports.Import$ = exports.GroupingIdentifier$ = exports.Grok$ = exports.GetTransformerResponse$ = exports.GetTransformerRequest$ = exports.GetScheduledQueryResponse$ = exports.GetScheduledQueryRequest$ = exports.GetScheduledQueryHistoryResponse$ = exports.GetScheduledQueryHistoryRequest$ = exports.GetQueryResultsResponse$ = exports.GetQueryResultsRequest$ = exports.GetLogRecordResponse$ = exports.GetLogRecordRequest$ = exports.GetLogObjectResponse$ = exports.GetLogObjectRequest$ = exports.GetLogGroupFieldsResponse$ = exports.GetLogGroupFieldsRequest$ = exports.GetLogFieldsResponse$ = void 0;
exports.PutIndexPolicyRequest$ = exports.PutDestinationResponse$ = exports.PutDestinationRequest$ = exports.PutDestinationPolicyRequest$ = exports.PutDeliverySourceResponse$ = exports.PutDeliverySourceRequest$ = exports.PutDeliveryDestinationResponse$ = exports.PutDeliveryDestinationRequest$ = exports.PutDeliveryDestinationPolicyResponse$ = exports.PutDeliveryDestinationPolicyRequest$ = exports.PutDataProtectionPolicyResponse$ = exports.PutDataProtectionPolicyRequest$ = exports.PutBearerTokenAuthenticationRequest$ = exports.PutAccountPolicyResponse$ = exports.PutAccountPolicyRequest$ = exports.Processor$ = exports.Policy$ = exports.PatternToken$ = exports.ParseWAF$ = exports.ParseVPC$ = exports.ParseToOCSF$ = exports.ParseRoute53$ = exports.ParsePostgres$ = exports.ParseKeyValue$ = exports.ParseJSON$ = exports.ParseCloudfront$ = exports.OutputLogEvent$ = exports.OpenSearchWorkspace$ = exports.OpenSearchResourceStatus$ = exports.OpenSearchResourceConfig$ = exports.OpenSearchNetworkPolicy$ = exports.OpenSearchLifecyclePolicy$ = exports.OpenSearchIntegrationDetails$ = exports.OpenSearchEncryptionPolicy$ = exports.OpenSearchDataSource$ = exports.OpenSearchDataAccessPolicy$ = exports.OpenSearchCollection$ = exports.OpenSearchApplication$ = exports.MoveKeys$ = exports.MoveKeyEntry$ = exports.MetricTransformation$ = exports.MetricFilterMatchRecord$ = exports.MetricFilter$ = exports.LowerCaseString$ = exports.LogStream$ = exports.LogGroupSummary$ = exports.LogGroupField$ = exports.LogGroup$ = exports.LogFieldType$ = exports.LogFieldsListItem$ = void 0;
exports.TestTransformerResponse$ = exports.TestTransformerRequest$ = exports.TestMetricFilterResponse$ = exports.TestMetricFilterRequest$ = exports.TagResourceRequest$ = exports.TagLogGroupRequest$ = exports.SuppressionPeriod$ = exports.SubstituteStringEntry$ = exports.SubstituteString$ = exports.SubscriptionFilter$ = exports.StopQueryResponse$ = exports.StopQueryRequest$ = exports.StartQueryResponse$ = exports.StartQueryRequest$ = exports.StartLiveTailResponse$ = exports.StartLiveTailRequest$ = exports.SplitStringEntry$ = exports.SplitString$ = exports.SearchedLogStream$ = exports.ScheduledQuerySummary$ = exports.ScheduledQueryDestination$ = exports.S3TableIntegrationSource$ = exports.S3DeliveryConfiguration$ = exports.S3Configuration$ = exports.ResultField$ = exports.ResourcePolicy$ = exports.RenameKeys$ = exports.RenameKeyEntry$ = exports.RejectedLogEventsInfo$ = exports.RejectedEntityInfo$ = exports.RecordField$ = exports.QueryStatistics$ = exports.QueryInfo$ = exports.QueryDefinition$ = exports.QueryCompileErrorLocation$ = exports.QueryCompileError$ = exports.PutTransformerRequest$ = exports.PutSubscriptionFilterRequest$ = exports.PutRetentionPolicyRequest$ = exports.PutResourcePolicyResponse$ = exports.PutResourcePolicyRequest$ = exports.PutQueryDefinitionResponse$ = exports.PutQueryDefinitionRequest$ = exports.PutMetricFilterRequest$ = exports.PutLogGroupDeletionProtectionRequest$ = exports.PutLogEventsResponse$ = exports.PutLogEventsRequest$ = exports.PutIntegrationResponse$ = exports.PutIntegrationRequest$ = exports.PutIndexPolicyResponse$ = void 0;
exports.DescribeConfigurationTemplates$ = exports.DescribeAccountPolicies$ = exports.DeleteTransformer$ = exports.DeleteSubscriptionFilter$ = exports.DeleteScheduledQuery$ = exports.DeleteRetentionPolicy$ = exports.DeleteResourcePolicy$ = exports.DeleteQueryDefinition$ = exports.DeleteMetricFilter$ = exports.DeleteLogStream$ = exports.DeleteLogGroup$ = exports.DeleteLogAnomalyDetector$ = exports.DeleteIntegration$ = exports.DeleteIndexPolicy$ = exports.DeleteDestination$ = exports.DeleteDeliverySource$ = exports.DeleteDeliveryDestinationPolicy$ = exports.DeleteDeliveryDestination$ = exports.DeleteDelivery$ = exports.DeleteDataProtectionPolicy$ = exports.DeleteAccountPolicy$ = exports.CreateScheduledQuery$ = exports.CreateLogStream$ = exports.CreateLogGroup$ = exports.CreateLogAnomalyDetector$ = exports.CreateImportTask$ = exports.CreateExportTask$ = exports.CreateDelivery$ = exports.CancelImportTask$ = exports.CancelExportTask$ = exports.AssociateSourceToS3TableIntegration$ = exports.AssociateKmsKey$ = exports.StartLiveTailResponseStream$ = exports.ResourceConfig$ = exports.IntegrationDetails$ = exports.GetLogObjectResponseStream$ = exports.UpperCaseString$ = exports.UpdateScheduledQueryResponse$ = exports.UpdateScheduledQueryRequest$ = exports.UpdateLogAnomalyDetectorRequest$ = exports.UpdateDeliveryConfigurationResponse$ = exports.UpdateDeliveryConfigurationRequest$ = exports.UpdateAnomalyRequest$ = exports.UntagResourceRequest$ = exports.UntagLogGroupRequest$ = exports.TypeConverterEntry$ = exports.TypeConverter$ = exports.TrimString$ = exports.TriggerHistoryRecord$ = exports.TransformedLogRecord$ = void 0;
exports.PutDeliveryDestinationPolicy$ = exports.PutDeliveryDestination$ = exports.PutDataProtectionPolicy$ = exports.PutBearerTokenAuthentication$ = exports.PutAccountPolicy$ = exports.ListTagsLogGroup$ = exports.ListTagsForResource$ = exports.ListSourcesForS3TableIntegration$ = exports.ListScheduledQueries$ = exports.ListLogGroupsForQuery$ = exports.ListLogGroups$ = exports.ListLogAnomalyDetectors$ = exports.ListIntegrations$ = exports.ListAnomalies$ = exports.ListAggregateLogGroupSummaries$ = exports.GetTransformer$ = exports.GetScheduledQueryHistory$ = exports.GetScheduledQuery$ = exports.GetQueryResults$ = exports.GetLogRecord$ = exports.GetLogObject$ = exports.GetLogGroupFields$ = exports.GetLogFields$ = exports.GetLogEvents$ = exports.GetLogAnomalyDetector$ = exports.GetIntegration$ = exports.GetDeliverySource$ = exports.GetDeliveryDestinationPolicy$ = exports.GetDeliveryDestination$ = exports.GetDelivery$ = exports.GetDataProtectionPolicy$ = exports.FilterLogEvents$ = exports.DisassociateSourceFromS3TableIntegration$ = exports.DisassociateKmsKey$ = exports.DescribeSubscriptionFilters$ = exports.DescribeResourcePolicies$ = exports.DescribeQueryDefinitions$ = exports.DescribeQueries$ = exports.DescribeMetricFilters$ = exports.DescribeLogStreams$ = exports.DescribeLogGroups$ = exports.DescribeIndexPolicies$ = exports.DescribeImportTasks$ = exports.DescribeImportTaskBatches$ = exports.DescribeFieldIndexes$ = exports.DescribeExportTasks$ = exports.DescribeDestinations$ = exports.DescribeDeliverySources$ = exports.DescribeDeliveryDestinations$ = exports.DescribeDeliveries$ = void 0;
exports.UpdateScheduledQuery$ = exports.UpdateLogAnomalyDetector$ = exports.UpdateDeliveryConfiguration$ = exports.UpdateAnomaly$ = exports.UntagResource$ = exports.UntagLogGroup$ = exports.TestTransformer$ = exports.TestMetricFilter$ = exports.TagResource$ = exports.TagLogGroup$ = exports.StopQuery$ = exports.StartQuery$ = exports.StartLiveTail$ = exports.PutTransformer$ = exports.PutSubscriptionFilter$ = exports.PutRetentionPolicy$ = exports.PutResourcePolicy$ = exports.PutQueryDefinition$ = exports.PutMetricFilter$ = exports.PutLogGroupDeletionProtection$ = exports.PutLogEvents$ = exports.PutIntegration$ = exports.PutIndexPolicy$ = exports.PutDestinationPolicy$ = exports.PutDestination$ = exports.PutDeliverySource$ = void 0;
const _A = "Anomaly";
const _AD = "AnomalyDetector";
const _ADE = "AccessDeniedException";
const _ADn = "AnomalyDetectors";
const _AF = "AllowedFields";
const _AK = "AddKeys";
const _AKE = "AddKeyEntry";
const _AKEd = "AddKeyEntries";
const _AKK = "AssociateKmsKey";
const _AKKR = "AssociateKmsKeyRequest";
const _ALGS = "AggregateLogGroupSummary";
const _ALGSg = "AggregateLogGroupSummaries";
const _AP = "AccountPolicy";
const _APc = "AccountPolicies";
const _ASTSTI = "AssociateSourceToS3TableIntegration";
const _ASTSTIR = "AssociateSourceToS3TableIntegrationRequest";
const _ASTSTIRs = "AssociateSourceToS3TableIntegrationResponse";
const _An = "Anomalies";
const _CD = "CreateDelivery";
const _CDR = "CreateDeliveryRequest";
const _CDRr = "CreateDeliveryResponse";
const _CE = "ConflictException";
const _CET = "CancelExportTask";
const _CETR = "CancelExportTaskRequest";
const _CETRr = "CreateExportTaskRequest";
const _CETRre = "CreateExportTaskResponse";
const _CETr = "CreateExportTask";
const _CIT = "CancelImportTask";
const _CITR = "CancelImportTaskRequest";
const _CITRa = "CancelImportTaskResponse";
const _CITRr = "CreateImportTaskRequest";
const _CITRre = "CreateImportTaskResponse";
const _CITr = "CreateImportTask";
const _CLAD = "CreateLogAnomalyDetector";
const _CLADR = "CreateLogAnomalyDetectorRequest";
const _CLADRr = "CreateLogAnomalyDetectorResponse";
const _CLG = "CreateLogGroup";
const _CLGR = "CreateLogGroupRequest";
const _CLS = "CreateLogStream";
const _CLSR = "CreateLogStreamRequest";
const _CSQ = "CreateScheduledQuery";
const _CSQR = "CreateScheduledQueryRequest";
const _CSQRr = "CreateScheduledQueryResponse";
const _CSV = "CSV";
const _CT = "ConfigurationTemplate";
const _CTDCV = "ConfigurationTemplateDeliveryConfigValues";
const _CTo = "ConfigurationTemplates";
const _CV = "CopyValue";
const _CVE = "CopyValueEntry";
const _CVEo = "CopyValueEntries";
const _D = "Delivery";
const _DAAE = "DataAlreadyAcceptedException";
const _DAP = "DeleteAccountPolicy";
const _DAPR = "DeleteAccountPolicyRequest";
const _DAPRe = "DescribeAccountPoliciesRequest";
const _DAPRes = "DescribeAccountPoliciesResponse";
const _DAPe = "DescribeAccountPolicies";
const _DC = "DestinationConfiguration";
const _DCT = "DescribeConfigurationTemplates";
const _DCTR = "DescribeConfigurationTemplatesRequest";
const _DCTRe = "DescribeConfigurationTemplatesResponse";
const _DD = "DeliveryDestination";
const _DDC = "DeliveryDestinationConfiguration";
const _DDD = "DeleteDeliveryDestination";
const _DDDP = "DeleteDeliveryDestinationPolicy";
const _DDDPR = "DeleteDeliveryDestinationPolicyRequest";
const _DDDR = "DeleteDeliveryDestinationRequest";
const _DDDRe = "DescribeDeliveryDestinationsRequest";
const _DDDRes = "DescribeDeliveryDestinationsResponse";
const _DDDe = "DescribeDeliveryDestinations";
const _DDPP = "DeleteDataProtectionPolicy";
const _DDPPR = "DeleteDataProtectionPolicyRequest";
const _DDR = "DeleteDeliveryRequest";
const _DDRe = "DeleteDestinationRequest";
const _DDRes = "DescribeDeliveriesRequest";
const _DDResc = "DescribeDeliveriesResponse";
const _DDRescr = "DescribeDestinationsRequest";
const _DDRescri = "DescribeDestinationsResponse";
const _DDS = "DeleteDeliverySource";
const _DDSR = "DeleteDeliverySourceRequest";
const _DDSRe = "DescribeDeliverySourcesRequest";
const _DDSRes = "DescribeDeliverySourcesResponse";
const _DDSe = "DescribeDeliverySources";
const _DDe = "DeliveryDestinations";
const _DDel = "DeleteDelivery";
const _DDele = "DeleteDestination";
const _DDes = "DescribeDeliveries";
const _DDesc = "DescribeDestinations";
const _DET = "DescribeExportTasks";
const _DETR = "DescribeExportTasksRequest";
const _DETRe = "DescribeExportTasksResponse";
const _DFI = "DescribeFieldIndexes";
const _DFIR = "DescribeFieldIndexesRequest";
const _DFIRe = "DescribeFieldIndexesResponse";
const _DI = "DeleteIntegration";
const _DIP = "DeleteIndexPolicy";
const _DIPR = "DeleteIndexPolicyRequest";
const _DIPRe = "DeleteIndexPolicyResponse";
const _DIPRes = "DescribeIndexPoliciesRequest";
const _DIPResc = "DescribeIndexPoliciesResponse";
const _DIPe = "DescribeIndexPolicies";
const _DIR = "DeleteIntegrationRequest";
const _DIRe = "DeleteIntegrationResponse";
const _DIT = "DescribeImportTasks";
const _DITB = "DescribeImportTaskBatches";
const _DITBR = "DescribeImportTaskBatchesRequest";
const _DITBRe = "DescribeImportTaskBatchesResponse";
const _DITR = "DescribeImportTasksRequest";
const _DITRe = "DescribeImportTasksResponse";
const _DK = "DeleteKeys";
const _DKK = "DisassociateKmsKey";
const _DKKR = "DisassociateKmsKeyRequest";
const _DLAD = "DeleteLogAnomalyDetector";
const _DLADR = "DeleteLogAnomalyDetectorRequest";
const _DLG = "DeleteLogGroup";
const _DLGR = "DeleteLogGroupRequest";
const _DLGRe = "DescribeLogGroupsRequest";
const _DLGRes = "DescribeLogGroupsResponse";
const _DLGe = "DescribeLogGroups";
const _DLS = "DeleteLogStream";
const _DLSR = "DeleteLogStreamRequest";
const _DLSRe = "DescribeLogStreamsRequest";
const _DLSRes = "DescribeLogStreamsResponse";
const _DLSe = "DescribeLogStreams";
const _DMF = "DeleteMetricFilter";
const _DMFR = "DeleteMetricFilterRequest";
const _DMFRe = "DescribeMetricFiltersRequest";
const _DMFRes = "DescribeMetricFiltersResponse";
const _DMFe = "DescribeMetricFilters";
const _DNP = "DestinationNamePrefix";
const _DQ = "DescribeQueries";
const _DQD = "DeleteQueryDefinition";
const _DQDR = "DeleteQueryDefinitionRequest";
const _DQDRe = "DeleteQueryDefinitionResponse";
const _DQDRes = "DescribeQueryDefinitionsRequest";
const _DQDResc = "DescribeQueryDefinitionsResponse";
const _DQDe = "DescribeQueryDefinitions";
const _DQR = "DescribeQueriesRequest";
const _DQRe = "DescribeQueriesResponse";
const _DRP = "DeleteResourcePolicy";
const _DRPR = "DeleteResourcePolicyRequest";
const _DRPRe = "DeleteRetentionPolicyRequest";
const _DRPRes = "DescribeResourcePoliciesRequest";
const _DRPResc = "DescribeResourcePoliciesResponse";
const _DRPe = "DeleteRetentionPolicy";
const _DRPes = "DescribeResourcePolicies";
const _DS = "DataSource";
const _DSF = "DataSourceFilter";
const _DSFR = "DeleteSubscriptionFilterRequest";
const _DSFRe = "DescribeSubscriptionFiltersRequest";
const _DSFRes = "DescribeSubscriptionFiltersResponse";
const _DSFSTI = "DisassociateSourceFromS3TableIntegration";
const _DSFSTIR = "DisassociateSourceFromS3TableIntegrationRequest";
const _DSFSTIRi = "DisassociateSourceFromS3TableIntegrationResponse";
const _DSFa = "DataSourceFilters";
const _DSFe = "DeleteSubscriptionFilter";
const _DSFes = "DescribeSubscriptionFilters";
const _DSQ = "DeleteScheduledQuery";
const _DSQR = "DeleteScheduledQueryRequest";
const _DSQRe = "DeleteScheduledQueryResponse";
const _DSe = "DeliverySource";
const _DSel = "DeliverySources";
const _DT = "DeleteTransformer";
const _DTC = "DateTimeConverter";
const _DTR = "DeleteTransformerRequest";
const _De = "Destination";
const _Del = "Deliveries";
const _Des = "Destinations";
const _E = "Entity";
const _ET = "ExportTask";
const _ETEI = "ExportTaskExecutionInfo";
const _ETS = "ExportTaskStatus";
const _ETx = "ExportTasks";
const _FD = "FieldsData";
const _FI = "FieldIndex";
const _FIi = "FieldIndexes";
const _FLE = "FilteredLogEvent";
const _FLER = "FilterLogEventsRequest";
const _FLERi = "FilterLogEventsResponse";
const _FLEi = "FilteredLogEvents";
const _FLEil = "FilterLogEvents";
const _G = "Grok";
const _GD = "GetDelivery";
const _GDD = "GetDeliveryDestination";
const _GDDP = "GetDeliveryDestinationPolicy";
const _GDDPR = "GetDeliveryDestinationPolicyRequest";
const _GDDPRe = "GetDeliveryDestinationPolicyResponse";
const _GDDR = "GetDeliveryDestinationRequest";
const _GDDRe = "GetDeliveryDestinationResponse";
const _GDPP = "GetDataProtectionPolicy";
const _GDPPR = "GetDataProtectionPolicyRequest";
const _GDPPRe = "GetDataProtectionPolicyResponse";
const _GDR = "GetDeliveryRequest";
const _GDRe = "GetDeliveryResponse";
const _GDS = "GetDeliverySource";
const _GDSR = "GetDeliverySourceRequest";
const _GDSRe = "GetDeliverySourceResponse";
const _GI = "GroupingIdentifier";
const _GIR = "GetIntegrationRequest";
const _GIRe = "GetIntegrationResponse";
const _GIe = "GetIntegration";
const _GIr = "GroupingIdentifiers";
const _GLAD = "GetLogAnomalyDetector";
const _GLADR = "GetLogAnomalyDetectorRequest";
const _GLADRe = "GetLogAnomalyDetectorResponse";
const _GLE = "GetLogEvents";
const _GLER = "GetLogEventsRequest";
const _GLERe = "GetLogEventsResponse";
const _GLF = "GetLogFields";
const _GLFR = "GetLogFieldsRequest";
const _GLFRe = "GetLogFieldsResponse";
const _GLGF = "GetLogGroupFields";
const _GLGFR = "GetLogGroupFieldsRequest";
const _GLGFRe = "GetLogGroupFieldsResponse";
const _GLO = "GetLogObject";
const _GLOR = "GetLogObjectRequest";
const _GLORS = "GetLogObjectResponseStream";
const _GLORe = "GetLogObjectResponse";
const _GLR = "GetLogRecord";
const _GLRR = "GetLogRecordRequest";
const _GLRRe = "GetLogRecordResponse";
const _GQR = "GetQueryResults";
const _GQRR = "GetQueryResultsRequest";
const _GQRRe = "GetQueryResultsResponse";
const _GSQ = "GetScheduledQuery";
const _GSQH = "GetScheduledQueryHistory";
const _GSQHR = "GetScheduledQueryHistoryRequest";
const _GSQHRe = "GetScheduledQueryHistoryResponse";
const _GSQR = "GetScheduledQueryRequest";
const _GSQRe = "GetScheduledQueryResponse";
const _GT = "GetTransformer";
const _GTR = "GetTransformerRequest";
const _GTRe = "GetTransformerResponse";
const _I = "Import";
const _IB = "ImportBatch";
const _IBL = "ImportBatchList";
const _ID = "IntegrationDetails";
const _IF = "ImportFilter";
const _IL = "ImportList";
const _ILE = "InputLogEvent";
const _ILEn = "InputLogEvents";
const _IOE = "InvalidOperationException";
const _IP = "IndexPolicy";
const _IPE = "InvalidParameterException";
const _IPn = "IndexPolicies";
const _IS = "ImportStatistics";
const _ISE = "InternalServerException";
const _ISEn = "InternalStreamingException";
const _ISTE = "InvalidSequenceTokenException";
const _ISn = "IntegrationSummary";
const _ISnt = "IntegrationSummaries";
const _LA = "ListAnomalies";
const _LALGS = "ListAggregateLogGroupSummaries";
const _LALGSR = "ListAggregateLogGroupSummariesRequest";
const _LALGSRi = "ListAggregateLogGroupSummariesResponse";
const _LAR = "ListAnomaliesRequest";
const _LARi = "ListAnomaliesResponse";
const _LCS = "LowerCaseString";
const _LE = "LogEvent";
const _LEE = "LimitExceededException";
const _LFL = "LogFieldsList";
const _LFLI = "LogFieldsListItem";
const _LFT = "LogFieldType";
const _LG = "LogGroup";
const _LGF = "LogGroupField";
const _LGFL = "LogGroupFieldList";
const _LGS = "LogGroupSummary";
const _LGSo = "LogGroupSummaries";
const _LGo = "LogGroups";
const _LI = "ListIntegrations";
const _LIR = "ListIntegrationsRequest";
const _LIRi = "ListIntegrationsResponse";
const _LLAD = "ListLogAnomalyDetectors";
const _LLADR = "ListLogAnomalyDetectorsRequest";
const _LLADRi = "ListLogAnomalyDetectorsResponse";
const _LLG = "ListLogGroups";
const _LLGFQ = "ListLogGroupsForQuery";
const _LLGFQR = "ListLogGroupsForQueryRequest";
const _LLGFQRi = "ListLogGroupsForQueryResponse";
const _LLGR = "ListLogGroupsRequest";
const _LLGRi = "ListLogGroupsResponse";
const _LS = "LogStream";
const _LSFSTI = "ListSourcesForS3TableIntegration";
const _LSFSTIR = "ListSourcesForS3TableIntegrationRequest";
const _LSFSTIRi = "ListSourcesForS3TableIntegrationResponse";
const _LSQ = "ListScheduledQueries";
const _LSQR = "ListScheduledQueriesRequest";
const _LSQRi = "ListScheduledQueriesResponse";
const _LSo = "LogSamples";
const _LSog = "LogStreams";
const _LTFR = "ListTagsForResource";
const _LTFRR = "ListTagsForResourceRequest";
const _LTFRRi = "ListTagsForResourceResponse";
const _LTLG = "ListTagsLogGroup";
const _LTLGR = "ListTagsLogGroupRequest";
const _LTLGRi = "ListTagsLogGroupResponse";
const _LTM = "ListToMap";
const _LTSLE = "LiveTailSessionLogEvent";
const _LTSM = "LiveTailSessionMetadata";
const _LTSR = "LiveTailSessionResults";
const _LTSS = "LiveTailSessionStart";
const _LTSU = "LiveTailSessionUpdate";
const _MF = "MetricFilter";
const _MFM = "MetricFilterMatches";
const _MFMR = "MetricFilterMatchRecord";
const _MFe = "MetricFilters";
const _MK = "MoveKeys";
const _MKE = "MoveKeyEntry";
const _MKEo = "MoveKeyEntries";
const _MQE = "MalformedQueryException";
const _MT = "MetricTransformation";
const _MTe = "MetricTransformations";
const _OAE = "OperationAbortedException";
const _OLE = "OutputLogEvent";
const _OLEu = "OutputLogEvents";
const _OSA = "OpenSearchApplication";
const _OSC = "OpenSearchCollection";
const _OSDAP = "OpenSearchDataAccessPolicy";
const _OSDS = "OpenSearchDataSource";
const _OSEP = "OpenSearchEncryptionPolicy";
const _OSID = "OpenSearchIntegrationDetails";
const _OSLP = "OpenSearchLifecyclePolicy";
const _OSNP = "OpenSearchNetworkPolicy";
const _OSRC = "OpenSearchResourceConfig";
const _OSRS = "OpenSearchResourceStatus";
const _OSW = "OpenSearchWorkspace";
const _P = "Policy";
const _PAP = "PutAccountPolicy";
const _PAPR = "PutAccountPolicyRequest";
const _PAPRu = "PutAccountPolicyResponse";
const _PBTA = "PutBearerTokenAuthentication";
const _PBTAR = "PutBearerTokenAuthenticationRequest";
const _PC = "ParseCloudfront";
const _PD = "PutDestination";
const _PDD = "PutDeliveryDestination";
const _PDDP = "PutDeliveryDestinationPolicy";
const _PDDPR = "PutDeliveryDestinationPolicyRequest";
const _PDDPRu = "PutDeliveryDestinationPolicyResponse";
const _PDDR = "PutDeliveryDestinationRequest";
const _PDDRu = "PutDeliveryDestinationResponse";
const _PDP = "PutDestinationPolicy";
const _PDPP = "PutDataProtectionPolicy";
const _PDPPR = "PutDataProtectionPolicyRequest";
const _PDPPRu = "PutDataProtectionPolicyResponse";
const _PDPR = "PutDestinationPolicyRequest";
const _PDR = "PutDestinationRequest";
const _PDRu = "PutDestinationResponse";
const _PDS = "PutDeliverySource";
const _PDSR = "PutDeliverySourceRequest";
const _PDSRu = "PutDeliverySourceResponse";
const _PI = "PutIntegration";
const _PIP = "PutIndexPolicy";
const _PIPR = "PutIndexPolicyRequest";
const _PIPRu = "PutIndexPolicyResponse";
const _PIR = "PutIntegrationRequest";
const _PIRu = "PutIntegrationResponse";
const _PJSON = "ParseJSON";
const _PKV = "ParseKeyValue";
const _PLE = "PutLogEvents";
const _PLER = "PutLogEventsRequest";
const _PLERu = "PutLogEventsResponse";
const _PLGDP = "PutLogGroupDeletionProtection";
const _PLGDPR = "PutLogGroupDeletionProtectionRequest";
const _PMF = "PutMetricFilter";
const _PMFR = "PutMetricFilterRequest";
const _PP = "ParsePostgres";
const _PQD = "PutQueryDefinition";
const _PQDR = "PutQueryDefinitionRequest";
const _PQDRu = "PutQueryDefinitionResponse";
const _PR = "ParseRoute53";
const _PRP = "PutResourcePolicy";
const _PRPR = "PutResourcePolicyRequest";
const _PRPRu = "PutResourcePolicyResponse";
const _PRPRut = "PutRetentionPolicyRequest";
const _PRPu = "PutRetentionPolicy";
const _PSF = "PutSubscriptionFilter";
const _PSFR = "PutSubscriptionFilterRequest";
const _PT = "PatternToken";
const _PTOCSF = "ParseToOCSF";
const _PTR = "PutTransformerRequest";
const _PTa = "PatternTokens";
const _PTu = "PutTransformer";
const _PVPC = "ParseVPC";
const _PWAF = "ParseWAF";
const _Pr = "Processor";
const _Pro = "Processors";
const _QCE = "QueryCompileError";
const _QCEL = "QueryCompileErrorLocation";
const _QD = "QueryDefinition";
const _QDL = "QueryDefinitionList";
const _QI = "QueryInfo";
const _QIL = "QueryInfoList";
const _QR = "QueryResults";
const _QS = "QueryStatistics";
const _RAEE = "ResourceAlreadyExistsException";
const _RC = "ResourceConfig";
const _REI = "RejectedEntityInfo";
const _RF = "RecordField";
const _RFe = "ResultField";
const _RK = "RenameKeys";
const _RKE = "RenameKeyEntry";
const _RKEe = "RenameKeyEntries";
const _RLEI = "RejectedLogEventsInfo";
const _RNFE = "ResourceNotFoundException";
const _RP = "ResourcePolicy";
const _RPe = "ResourcePolicies";
const _RR = "ResultRows";
const _SC = "S3Configuration";
const _SDC = "S3DeliveryConfiguration";
const _SF = "SubscriptionFilter";
const _SFu = "SubscriptionFilters";
const _SLS = "SearchedLogStream";
const _SLSe = "SearchedLogStreams";
const _SLT = "StartLiveTail";
const _SLTR = "StartLiveTailRequest";
const _SLTRS = "StartLiveTailResponseStream";
const _SLTRt = "StartLiveTailResponse";
const _SP = "SuppressionPeriod";
const _SQ = "StartQuery";
const _SQD = "ScheduledQueryDestination";
const _SQDL = "ScheduledQueryDestinationList";
const _SQEE = "ServiceQuotaExceededException";
const _SQR = "StartQueryRequest";
const _SQRt = "StartQueryResponse";
const _SQRto = "StopQueryRequest";
const _SQRtop = "StopQueryResponse";
const _SQS = "ScheduledQuerySummary";
const _SQSL = "ScheduledQuerySummaryList";
const _SQt = "StopQuery";
const _SS = "SplitString";
const _SSE = "SessionStreamingException";
const _SSEp = "SplitStringEntry";
const _SSEpl = "SplitStringEntries";
const _SSEu = "SubstituteStringEntry";
const _SSEub = "SubstituteStringEntries";
const _SSu = "SubstituteString";
const _STE = "SessionTimeoutException";
const _STIS = "S3TableIntegrationSource";
const _STISa = "S3TableIntegrationSources";
const _SUE = "ServiceUnavailableException";
const _TC = "TypeConverter";
const _TCE = "TypeConverterEntry";
const _TCEy = "TypeConverterEntries";
const _TE = "ThrottlingException";
const _THR = "TriggerHistoryRecord";
const _THRL = "TriggerHistoryRecordList";
const _TL = "TransformedLogs";
const _TLG = "TagLogGroup";
const _TLGR = "TagLogGroupRequest";
const _TLR = "TransformedLogRecord";
const _TMF = "TestMetricFilter";
const _TMFR = "TestMetricFilterRequest";
const _TMFRe = "TestMetricFilterResponse";
const _TMTE = "TooManyTagsException";
const _TR = "TagResource";
const _TRR = "TagResourceRequest";
const _TS = "TrimString";
const _TT = "TestTransformer";
const _TTR = "TestTransformerRequest";
const _TTRe = "TestTransformerResponse";
const _UA = "UpdateAnomaly";
const _UAR = "UpdateAnomalyRequest";
const _UCE = "UnrecognizedClientException";
const _UCS = "UpperCaseString";
const _UDC = "UpdateDeliveryConfiguration";
const _UDCR = "UpdateDeliveryConfigurationRequest";
const _UDCRp = "UpdateDeliveryConfigurationResponse";
const _ULAD = "UpdateLogAnomalyDetector";
const _ULADR = "UpdateLogAnomalyDetectorRequest";
const _ULG = "UntagLogGroup";
const _ULGR = "UntagLogGroupRequest";
const _UR = "UntagResource";
const _URR = "UntagResourceRequest";
const _USQ = "UpdateScheduledQuery";
const _USQR = "UpdateScheduledQueryRequest";
const _USQRp = "UpdateScheduledQueryResponse";
const _VE = "ValidationException";
const _a = "active";
const _aA = "applicationArn";
const _aAFAVLDFR = "allowedActionForAllowVendedLogsDeliveryForResource";
const _aD = "anomalyDetectors";
const _aDA = "anomalyDetectorArn";
const _aDS = "anomalyDetectorStatus";
const _aE = "applicationEndpoint";
const _aF = "allowedFields";
const _aFD = "allowedFieldDelimiters";
const _aI = "accountId";
const _aIc = "accountIdentifiers";
const _aIn = "anomalyId";
const _aIp = "applicationId";
const _aK = "addKeys";
const _aLGS = "aggregateLogGroupSummaries";
const _aOF = "allowedOutputFormats";
const _aOTL = "applyOnTransformedLogs";
const _aP = "accountPolicies";
const _aPc = "accessPolicy";
const _aPcc = "accountPolicy";
const _aSPF = "allowedSuffixPathFields";
const _aVT = "anomalyVisibilityTime";
const _an = "anomalies";
const _ap = "application";
const _ar = "arn";
const _at = "attributes";
const _b = "baseline";
const _bI = "batchId";
const _bIS = "batchImportStatus";
const _bIy = "bytesImported";
const _bS = "bytesScanned";
const _bTAE = "bearerTokenAuthenticationEnabled";
const _c = "client";
const _cA = "collectionArn";
const _cE = "collectionEndpoint";
const _cT = "creationTime";
const _cTS = "creationTimeStamp";
const _cTSr = "createdTimeStamp";
const _cTl = "clientToken";
const _cTo = "configurationTemplates";
const _cTom = "completionTime";
const _cTr = "createTime";
const _cV = "copyValue";
const _co = "columns";
const _cod = "code";
const _col = "collection";
const _cs = "csv";
const _d = "description";
const _dA = "destinationArn";
const _dC = "destinationConfiguration";
const _dD = "deliveryDestinations";
const _dDA = "deliveryDestinationArn";
const _dDC = "deliveryDestinationConfiguration";
const _dDCV = "defaultDeliveryConfigValues";
const _dDN = "deliveryDestinationName";
const _dDP = "deliveryDestinationPolicy";
const _dDT = "deliveryDestinationType";
const _dDTe = "deliveryDestinationTypes";
const _dDe = "deliveryDestination";
const _dI = "destinationIdentifier";
const _dK = "deleteKeys";
const _dN = "detectorName";
const _dNe = "destinationName";
const _dP = "destinationPrefix";
const _dPE = "deletionProtectionEnabled";
const _dPS = "dataProtectionStatus";
const _dRA = "destinationResourceArn";
const _dS = "dataSource";
const _dSN = "deliverySourceName";
const _dSNa = "dataSourceName";
const _dSRA = "dataSourceRoleArn";
const _dST = "dataSourceType";
const _dSa = "dataSources";
const _dSe = "deliverySources";
const _dSel = "deliverySource";
const _dT = "destinationType";
const _dTC = "dateTimeConverter";
const _dTP = "dynamicTokenPosition";
const _dV = "defaultValue";
const _dVP = "dashboardViewerPrincipals";
const _da = "data";
const _de = "delivery";
const _del = "delimiter";
const _deli = "deliveries";
const _des = "destination";
const _desc = "descending";
const _dest = "destinations";
const _di = "dimensions";
const _dis = "distribution";
const _e = "error";
const _eBS = "estimatedBytesSkipped";
const _eCO = "endCharOffset";
const _eET = "endEventTime";
const _eF = "evaluationFrequency";
const _eHCP = "enableHiveCompatiblePath";
const _eI = "executionInfo";
const _eIv = "eventId";
const _eK = "encryptionKey";
const _eLEEI = "expiredLogEventEndIndex";
const _eM = "errorMessage";
const _eMv = "eventMessage";
const _eN = "eventNumber";
const _eP = "encryptionPolicy";
const _eRA = "executionRoleArn";
const _eRI = "expectedRevisionId";
const _eRS = "estimatedRecordsSkipped";
const _eS = "executionStatuses";
const _eSF = "emitSystemFields";
const _eSFD = "emitSystemFieldDimensions";
const _eST = "expectedSequenceToken";
const _eSv = "eventSource";
const _eSx = "executionStatus";
const _eT = "exportTasks";
const _eTn = "endTime";
const _eTr = "errorType";
const _eV = "extractedValues";
const _el = "element";
const _en = "entries";
const _ena = "enabled";
const _end = "endpoint";
const _ent = "entity";
const _enu = "enumerations";
const _ev = "events";
const _f = "from";
const _fD = "fieldDelimiter";
const _fE = "flattenedElement";
const _fET = "firstEventTime";
const _fETi = "firstEventTimestamp";
const _fI = "fieldIndexes";
const _fIN = "fieldIndexName";
const _fINi = "fieldIndexNames";
const _fLGA = "filterLogGroupArn";
const _fN = "filterName";
const _fNP = "filterNamePrefix";
const _fP = "filterPattern";
const _fS = "firstSeen";
const _fSC = "fieldSelectionCriteria";
const _fSi = "fieldStream";
const _fU = "forceUpdate";
const _fi = "fields";
const _fie = "field";
const _fl = "flatten";
const _fo = "force";
const _g = "grok";
const _gB = "groupBy";
const _gI = "groupingIdentifiers";
const _h = "histogram";
const _hE = "httpError";
const _i = "identifier";
const _iA = "integrationArn";
const _iB = "importBatches";
const _iD = "integrationDetails";
const _iDA = "importDestinationArn";
const _iDs = "isDynamic";
const _iF = "importFilter";
const _iI = "importId";
const _iLA = "includeLinkedAccounts";
const _iN = "integrationName";
const _iNP = "integrationNamePrefix";
const _iP = "indexPolicies";
const _iPLS = "isPatternLevelSuppression";
const _iPn = "inheritedProperties";
const _iPnd = "indexPolicy";
const _iRA = "importRoleArn";
const _iS = "importStatistics";
const _iSA = "importSourceArn";
const _iSm = "importStatus";
const _iSn = "integrationStatus";
const _iSnt = "integrationSummaries";
const _iT = "ingestionTime";
const _iTN = "inferredTokenName";
const _iTn = "integrationType";
const _id = "id";
const _im = "imports";
const _in = "interleaved";
const _k = "key";
const _kA = "keyAttributes";
const _kKA = "kmsKeyArn";
const _kKI = "kmsKeyId";
const _kP = "keyPrefix";
const _kVD = "keyValueDelimiter";
const _l = "locale";
const _lCS = "lowerCaseString";
const _lE = "logEvents";
const _lEFP = "logEventFilterPattern";
const _lEM = "logEventMessages";
const _lES = "lastExecutionStatus";
const _lET = "lastEventTime";
const _lETa = "lastEventTimestamp";
const _lF = "logFields";
const _lFN = "logFieldName";
const _lFT = "logFieldType";
const _lG = "logGroups";
const _lGA = "logGroupArn";
const _lGAL = "logGroupArnList";
const _lGC = "logGroupCount";
const _lGCo = "logGroupClass";
const _lGF = "logGroupFields";
const _lGI = "logGroupIdentifiers";
const _lGIo = "logGroupIdentifier";
const _lGN = "logGroupName";
const _lGNP = "logGroupNamePrefix";
const _lGNPo = "logGroupNamePattern";
const _lGNo = "logGroupNames";
const _lGS = "logGroupsScanned";
const _lIT = "lastIngestionTime";
const _lM = "lastModified";
const _lMT = "lastModifiedTime";
const _lMTS = "lastModifiedTimeStamp";
const _lOP = "logObjectPointer";
const _lP = "lifecyclePolicy";
const _lR = "logRecord";
const _lRP = "logRecordPointer";
const _lS = "lastSeen";
const _lSN = "logStreamName";
const _lSNP = "logStreamNamePrefix";
const _lSNPo = "logStreamNamePrefixes";
const _lSNo = "logStreamNames";
const _lST = "lastScanTime";
const _lSo = "logSamples";
const _lSog = "logStreams";
const _lT = "logType";
const _lTM = "listToMap";
const _lTT = "lastTriggeredTime";
const _lTo = "logTypes";
const _lUT = "lastUpdatedTime";
const _lUTa = "lastUpdateTime";
const _li = "limit";
const _lo = "location";
const _m = "message";
const _mF = "metricFilters";
const _mFC = "metricFilterCount";
const _mK = "moveKeys";
const _mN = "metricName";
const _mNe = "metricNamespace";
const _mP = "matchPatterns";
const _mR = "maxResults";
const _mT = "metricTransformations";
const _mV = "metricValue";
const _mVa = "mappingVersion";
const _ma = "match";
const _man = "mandatory";
const _mat = "matches";
const _n = "name";
const _nBT = "nextBackwardToken";
const _nFT = "nextForwardToken";
const _nMV = "nonMatchValue";
const _nP = "networkPolicy";
const _nST = "nextSequenceToken";
const _nT = "nextToken";
const _oB = "orderBy";
const _oF = "outputFormat";
const _oIE = "overwriteIfExists";
const _oSID = "openSearchIntegrationDetails";
const _oSRC = "openSearchResourceConfig";
const _oV = "ocsfVersion";
const _p = "priority";
const _pC = "parseCloudfront";
const _pD = "policyDocument";
const _pI = "patternId";
const _pIr = "processedIdentifier";
const _pJSON = "parseJSON";
const _pKV = "parseKeyValue";
const _pN = "policyName";
const _pP = "parsePostgres";
const _pR = "patternRegex";
const _pRa = "parseRoute53";
const _pS = "patternString";
const _pSo = "policyScope";
const _pT = "policyType";
const _pTOCSF = "parseToOCSF";
const _pTa = "patternTokens";
const _pVPC = "parseVPC";
const _pWAF = "parseWAF";
const _pe = "percent";
const _po = "policy";
const _q = "queries";
const _qC = "quoteCharacter";
const _qCE = "queryCompileError";
const _qD = "queryDefinitions";
const _qDI = "queryDefinitionId";
const _qDNP = "queryDefinitionNamePrefix";
const _qI = "queryId";
const _qL = "queryLanguage";
const _qS = "queryString";
const _r = "results";
const _rA = "resourceArn";
const _rAe = "resourceArns";
const _rAo = "roleArn";
const _rC = "resourceConfig";
const _rD = "retentionDays";
const _rEI = "rejectedEntityInfo";
const _rF = "recordFields";
const _rI = "resourceIdentifier";
const _rID = "retentionInDays";
const _rIe = "requestId";
const _rIev = "revisionId";
const _rK = "renameKeys";
const _rLEI = "rejectedLogEventsInfo";
const _rM = "recordsMatched";
const _rN = "resourceName";
const _rP = "resourcePolicies";
const _rPe = "resourcePolicy";
const _rS = "recordsScanned";
const _rSe = "responseStream";
const _rT = "resourceType";
const _rTe = "resourceTypes";
const _rTen = "renameTo";
const _s = "smithy.ts.sdk.synthetic.com.amazonaws.cloudwatchlogs";
const _sB = "storedBytes";
const _sC = "selectionCriteria";
const _sCO = "startCharOffset";
const _sCe = "searchedCompletely";
const _sCo = "s3Configuration";
const _sCt = "statusCode";
const _sD = "suppressedDate";
const _sDC = "s3DeliveryConfiguration";
const _sE = "scheduleExpression";
const _sET = "scheduleEndTime";
const _sETt = "startEventTime";
const _sF = "subscriptionFilters";
const _sFH = "startFromHead";
const _sI = "sessionId";
const _sLS = "searchedLogStreams";
const _sM = "sessionMetadata";
const _sMt = "statusMessage";
const _sP = "suffixPath";
const _sPu = "suppressionPeriod";
const _sQ = "scheduledQueries";
const _sQA = "scheduledQueryArn";
const _sR = "sessionResults";
const _sRt = "statusReason";
const _sS = "suppressionState";
const _sST = "scheduleStartTime";
const _sSe = "sessionStart";
const _sSp = "splitString";
const _sSu = "substituteString";
const _sT = "sourceTimezone";
const _sTO = "startTimeOffset";
const _sTe = "sequenceToken";
const _sTt = "startTime";
const _sTu = "suppressionType";
const _sU = "suppressedUntil";
const _sUe = "sessionUpdate";
const _sUu = "suppressionUnit";
const _sa = "sampled";
const _sc = "scope";
const _se = "server";
const _ser = "service";
const _so = "source";
const _sou = "sources";
const _st = "state";
const _sta = "status";
const _stat = "statistics";
const _str = "streaming";
const _su = "suppressed";
const _suc = "success";
const _t = "target";
const _tA = "targetArn";
const _tC = "transformerConfig";
const _tCy = "typeConverter";
const _tEM = "transformedEventMessage";
const _tF = "targetFormat";
const _tH = "triggerHistory";
const _tI = "taskId";
const _tK = "tagKeys";
const _tL = "transformedLogs";
const _tN = "taskName";
const _tNLESI = "tooNewLogEventStartIndex";
const _tOLEEI = "tooOldLogEventEndIndex";
const _tS = "tokenString";
const _tSr = "trimString";
const _tT = "targetTimezone";
const _tTr = "triggeredTimestamp";
const _ta = "tags";
const _ti = "timezone";
const _tim = "timestamp";
const _time = "time";
const _to = "to";
const _ty = "type";
const _u = "unmask";
const _uCS = "upperCaseString";
const _uST = "uploadSequenceToken";
const _un = "unit";
const _v = "value";
const _vK = "valueKey";
const _w = "workspace";
const _wI = "workspaceId";
const _wK = "withKeys";
const n0 = "com.amazonaws.cloudwatchlogs";
const schema_1 = __webpack_require__(15982);
const CloudWatchLogsServiceException_1 = __webpack_require__(37951);
const errors_1 = __webpack_require__(8691);
const _s_registry = schema_1.TypeRegistry.for(_s);
exports.CloudWatchLogsServiceException$ = [-3, _s, "CloudWatchLogsServiceException", 0, [], []];
_s_registry.registerError(exports.CloudWatchLogsServiceException$, CloudWatchLogsServiceException_1.CloudWatchLogsServiceException);
const n0_registry = schema_1.TypeRegistry.for(n0);
exports.AccessDeniedException$ = [-3, n0, _ADE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.AccessDeniedException$, errors_1.AccessDeniedException);
exports.ConflictException$ = [-3, n0, _CE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.ConflictException$, errors_1.ConflictException);
exports.DataAlreadyAcceptedException$ = [-3, n0, _DAAE,
    { [_e]: _c },
    [_eST, _m],
    [0, 0]
];
n0_registry.registerError(exports.DataAlreadyAcceptedException$, errors_1.DataAlreadyAcceptedException);
exports.InternalServerException$ = [-3, n0, _ISE,
    { [_e]: _se, [_hE]: 500 },
    [_m],
    [0]
];
n0_registry.registerError(exports.InternalServerException$, errors_1.InternalServerException);
exports.InternalStreamingException$ = [-3, n0, _ISEn,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.InternalStreamingException$, errors_1.InternalStreamingException);
exports.InvalidOperationException$ = [-3, n0, _IOE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.InvalidOperationException$, errors_1.InvalidOperationException);
exports.InvalidParameterException$ = [-3, n0, _IPE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.InvalidParameterException$, errors_1.InvalidParameterException);
exports.InvalidSequenceTokenException$ = [-3, n0, _ISTE,
    { [_e]: _c },
    [_eST, _m],
    [0, 0]
];
n0_registry.registerError(exports.InvalidSequenceTokenException$, errors_1.InvalidSequenceTokenException);
exports.LimitExceededException$ = [-3, n0, _LEE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.LimitExceededException$, errors_1.LimitExceededException);
exports.MalformedQueryException$ = [-3, n0, _MQE,
    { [_e]: _c },
    [_qCE, _m],
    [() => exports.QueryCompileError$, 0]
];
n0_registry.registerError(exports.MalformedQueryException$, errors_1.MalformedQueryException);
exports.OperationAbortedException$ = [-3, n0, _OAE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.OperationAbortedException$, errors_1.OperationAbortedException);
exports.ResourceAlreadyExistsException$ = [-3, n0, _RAEE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.ResourceAlreadyExistsException$, errors_1.ResourceAlreadyExistsException);
exports.ResourceNotFoundException$ = [-3, n0, _RNFE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.ResourceNotFoundException$, errors_1.ResourceNotFoundException);
exports.ServiceQuotaExceededException$ = [-3, n0, _SQEE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.ServiceQuotaExceededException$, errors_1.ServiceQuotaExceededException);
exports.ServiceUnavailableException$ = [-3, n0, _SUE,
    { [_e]: _se },
    [_m],
    [0]
];
n0_registry.registerError(exports.ServiceUnavailableException$, errors_1.ServiceUnavailableException);
exports.SessionStreamingException$ = [-3, n0, _SSE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.SessionStreamingException$, errors_1.SessionStreamingException);
exports.SessionTimeoutException$ = [-3, n0, _STE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.SessionTimeoutException$, errors_1.SessionTimeoutException);
exports.ThrottlingException$ = [-3, n0, _TE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.ThrottlingException$, errors_1.ThrottlingException);
exports.TooManyTagsException$ = [-3, n0, _TMTE,
    { [_e]: _c, [_hE]: 400 },
    [_m, _rN],
    [0, 0]
];
n0_registry.registerError(exports.TooManyTagsException$, errors_1.TooManyTagsException);
exports.UnrecognizedClientException$ = [-3, n0, _UCE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.UnrecognizedClientException$, errors_1.UnrecognizedClientException);
exports.ValidationException$ = [-3, n0, _VE,
    { [_e]: _c },
    [_m],
    [0]
];
n0_registry.registerError(exports.ValidationException$, errors_1.ValidationException);
exports.errorTypeRegistries = [
    _s_registry,
    n0_registry,
];
exports.AccountPolicy$ = [3, n0, _AP,
    0,
    [_pN, _pD, _lUT, _pT, _sc, _sC, _aI],
    [0, 0, 1, 0, 0, 0, 0]
];
exports.AddKeyEntry$ = [3, n0, _AKE,
    0,
    [_k, _v, _oIE],
    [0, 0, 2], 2
];
exports.AddKeys$ = [3, n0, _AK,
    0,
    [_en],
    [() => AddKeyEntries], 1
];
exports.AggregateLogGroupSummary$ = [3, n0, _ALGS,
    0,
    [_lGC, _gI],
    [1, () => GroupingIdentifiers]
];
exports.Anomaly$ = [3, n0, _A,
    0,
    [_aIn, _pI, _aDA, _pS, _fS, _lS, _d, _a, _st, _h, _lSo, _pTa, _lGAL, _pR, _p, _su, _sD, _sU, _iPLS],
    [0, 0, 0, 0, 1, 1, 0, 2, 0, 128 | 1, () => LogSamples, () => PatternTokens, 64 | 0, 0, 0, 2, 1, 1, 2], 13
];
exports.AnomalyDetector$ = [3, n0, _AD,
    0,
    [_aDA, _dN, _lGAL, _eF, _fP, _aDS, _kKI, _cTS, _lMTS, _aVT],
    [0, 0, 64 | 0, 0, 0, 0, 0, 1, 1, 1]
];
exports.AssociateKmsKeyRequest$ = [3, n0, _AKKR,
    0,
    [_kKI, _lGN, _rI],
    [0, 0, 0], 1
];
exports.AssociateSourceToS3TableIntegrationRequest$ = [3, n0, _ASTSTIR,
    0,
    [_iA, _dS],
    [0, () => exports.DataSource$], 2
];
exports.AssociateSourceToS3TableIntegrationResponse$ = [3, n0, _ASTSTIRs,
    0,
    [_i],
    [0]
];
exports.CancelExportTaskRequest$ = [3, n0, _CETR,
    0,
    [_tI],
    [0], 1
];
exports.CancelImportTaskRequest$ = [3, n0, _CITR,
    0,
    [_iI],
    [0], 1
];
exports.CancelImportTaskResponse$ = [3, n0, _CITRa,
    0,
    [_iI, _iS, _iSm, _cT, _lUT],
    [0, () => exports.ImportStatistics$, 0, 1, 1]
];
exports.ConfigurationTemplate$ = [3, n0, _CT,
    0,
    [_ser, _lT, _rT, _dDT, _dDCV, _aF, _aOF, _aAFAVLDFR, _aFD, _aSPF],
    [0, 0, 0, 0, () => exports.ConfigurationTemplateDeliveryConfigValues$, () => AllowedFields, 64 | 0, 0, 64 | 0, 64 | 0]
];
exports.ConfigurationTemplateDeliveryConfigValues$ = [3, n0, _CTDCV,
    0,
    [_rF, _fD, _sDC],
    [64 | 0, 0, () => exports.S3DeliveryConfiguration$]
];
exports.CopyValue$ = [3, n0, _CV,
    0,
    [_en],
    [() => CopyValueEntries], 1
];
exports.CopyValueEntry$ = [3, n0, _CVE,
    0,
    [_so, _t, _oIE],
    [0, 0, 2], 2
];
exports.CreateDeliveryRequest$ = [3, n0, _CDR,
    0,
    [_dSN, _dDA, _rF, _fD, _sDC, _ta],
    [0, 0, 64 | 0, 0, () => exports.S3DeliveryConfiguration$, 128 | 0], 2
];
exports.CreateDeliveryResponse$ = [3, n0, _CDRr,
    0,
    [_de],
    [() => exports.Delivery$]
];
exports.CreateExportTaskRequest$ = [3, n0, _CETRr,
    0,
    [_lGN, _f, _to, _des, _tN, _lSNP, _dP],
    [0, 1, 1, 0, 0, 0, 0], 4
];
exports.CreateExportTaskResponse$ = [3, n0, _CETRre,
    0,
    [_tI],
    [0]
];
exports.CreateImportTaskRequest$ = [3, n0, _CITRr,
    0,
    [_iSA, _iRA, _iF],
    [0, 0, () => exports.ImportFilter$], 2
];
exports.CreateImportTaskResponse$ = [3, n0, _CITRre,
    0,
    [_iI, _iDA, _cT],
    [0, 0, 1]
];
exports.CreateLogAnomalyDetectorRequest$ = [3, n0, _CLADR,
    0,
    [_lGAL, _dN, _eF, _fP, _kKI, _aVT, _ta],
    [64 | 0, 0, 0, 0, 0, 1, 128 | 0], 1
];
exports.CreateLogAnomalyDetectorResponse$ = [3, n0, _CLADRr,
    0,
    [_aDA],
    [0]
];
exports.CreateLogGroupRequest$ = [3, n0, _CLGR,
    0,
    [_lGN, _kKI, _ta, _lGCo, _dPE],
    [0, 0, 128 | 0, 0, 2], 1
];
exports.CreateLogStreamRequest$ = [3, n0, _CLSR,
    0,
    [_lGN, _lSN],
    [0, 0], 2
];
exports.CreateScheduledQueryRequest$ = [3, n0, _CSQR,
    0,
    [_n, _qL, _qS, _sE, _eRA, _d, _lGI, _ti, _sTO, _dC, _sST, _sET, _st, _ta],
    [0, 0, 0, 0, 0, 0, 64 | 0, 0, 1, () => exports.DestinationConfiguration$, 1, 1, 0, 128 | 0], 5
];
exports.CreateScheduledQueryResponse$ = [3, n0, _CSQRr,
    0,
    [_sQA, _st],
    [0, 0]
];
exports.CSV$ = [3, n0, _CSV,
    0,
    [_qC, _del, _co, _so],
    [0, 0, 64 | 0, 0]
];
exports.DataSource$ = [3, n0, _DS,
    0,
    [_n, _ty],
    [0, 0], 1
];
exports.DataSourceFilter$ = [3, n0, _DSF,
    0,
    [_n, _ty],
    [0, 0], 1
];
exports.DateTimeConverter$ = [3, n0, _DTC,
    0,
    [_so, _t, _mP, _tF, _sT, _tT, _l],
    [0, 0, 64 | 0, 0, 0, 0, 0], 3
];
exports.DeleteAccountPolicyRequest$ = [3, n0, _DAPR,
    0,
    [_pN, _pT],
    [0, 0], 2
];
exports.DeleteDataProtectionPolicyRequest$ = [3, n0, _DDPPR,
    0,
    [_lGIo],
    [0], 1
];
exports.DeleteDeliveryDestinationPolicyRequest$ = [3, n0, _DDDPR,
    0,
    [_dDN],
    [0], 1
];
exports.DeleteDeliveryDestinationRequest$ = [3, n0, _DDDR,
    0,
    [_n],
    [0], 1
];
exports.DeleteDeliveryRequest$ = [3, n0, _DDR,
    0,
    [_id],
    [0], 1
];
exports.DeleteDeliverySourceRequest$ = [3, n0, _DDSR,
    0,
    [_n],
    [0], 1
];
exports.DeleteDestinationRequest$ = [3, n0, _DDRe,
    0,
    [_dNe],
    [0], 1
];
exports.DeleteIndexPolicyRequest$ = [3, n0, _DIPR,
    0,
    [_lGIo],
    [0], 1
];
exports.DeleteIndexPolicyResponse$ = [3, n0, _DIPRe,
    0,
    [],
    []
];
exports.DeleteIntegrationRequest$ = [3, n0, _DIR,
    0,
    [_iN, _fo],
    [0, 2], 1
];
exports.DeleteIntegrationResponse$ = [3, n0, _DIRe,
    0,
    [],
    []
];
exports.DeleteKeys$ = [3, n0, _DK,
    0,
    [_wK],
    [64 | 0], 1
];
exports.DeleteLogAnomalyDetectorRequest$ = [3, n0, _DLADR,
    0,
    [_aDA],
    [0], 1
];
exports.DeleteLogGroupRequest$ = [3, n0, _DLGR,
    0,
    [_lGN],
    [0], 1
];
exports.DeleteLogStreamRequest$ = [3, n0, _DLSR,
    0,
    [_lGN, _lSN],
    [0, 0], 2
];
exports.DeleteMetricFilterRequest$ = [3, n0, _DMFR,
    0,
    [_lGN, _fN],
    [0, 0], 2
];
exports.DeleteQueryDefinitionRequest$ = [3, n0, _DQDR,
    0,
    [_qDI],
    [0], 1
];
exports.DeleteQueryDefinitionResponse$ = [3, n0, _DQDRe,
    0,
    [_suc],
    [2]
];
exports.DeleteResourcePolicyRequest$ = [3, n0, _DRPR,
    0,
    [_pN, _rA, _eRI],
    [0, 0, 0]
];
exports.DeleteRetentionPolicyRequest$ = [3, n0, _DRPRe,
    0,
    [_lGN],
    [0], 1
];
exports.DeleteScheduledQueryRequest$ = [3, n0, _DSQR,
    0,
    [_i],
    [0], 1
];
exports.DeleteScheduledQueryResponse$ = [3, n0, _DSQRe,
    0,
    [],
    []
];
exports.DeleteSubscriptionFilterRequest$ = [3, n0, _DSFR,
    0,
    [_lGN, _fN],
    [0, 0], 2
];
exports.DeleteTransformerRequest$ = [3, n0, _DTR,
    0,
    [_lGIo],
    [0], 1
];
exports.Delivery$ = [3, n0, _D,
    0,
    [_id, _ar, _dSN, _dDA, _dDT, _rF, _fD, _sDC, _ta],
    [0, 0, 0, 0, 0, 64 | 0, 0, () => exports.S3DeliveryConfiguration$, 128 | 0]
];
exports.DeliveryDestination$ = [3, n0, _DD,
    0,
    [_n, _ar, _dDT, _oF, _dDC, _ta],
    [0, 0, 0, 0, () => exports.DeliveryDestinationConfiguration$, 128 | 0]
];
exports.DeliveryDestinationConfiguration$ = [3, n0, _DDC,
    0,
    [_dRA],
    [0], 1
];
exports.DeliverySource$ = [3, n0, _DSe,
    0,
    [_n, _ar, _rAe, _ser, _lT, _ta],
    [0, 0, 64 | 0, 0, 0, 128 | 0]
];
exports.DescribeAccountPoliciesRequest$ = [3, n0, _DAPRe,
    0,
    [_pT, _pN, _aIc, _nT],
    [0, 0, 64 | 0, 0], 1
];
exports.DescribeAccountPoliciesResponse$ = [3, n0, _DAPRes,
    0,
    [_aP, _nT],
    [() => AccountPolicies, 0]
];
exports.DescribeConfigurationTemplatesRequest$ = [3, n0, _DCTR,
    0,
    [_ser, _lTo, _rTe, _dDTe, _nT, _li],
    [0, 64 | 0, 64 | 0, 64 | 0, 0, 1]
];
exports.DescribeConfigurationTemplatesResponse$ = [3, n0, _DCTRe,
    0,
    [_cTo, _nT],
    [() => ConfigurationTemplates, 0]
];
exports.DescribeDeliveriesRequest$ = [3, n0, _DDRes,
    0,
    [_nT, _li],
    [0, 1]
];
exports.DescribeDeliveriesResponse$ = [3, n0, _DDResc,
    0,
    [_deli, _nT],
    [() => Deliveries, 0]
];
exports.DescribeDeliveryDestinationsRequest$ = [3, n0, _DDDRe,
    0,
    [_nT, _li],
    [0, 1]
];
exports.DescribeDeliveryDestinationsResponse$ = [3, n0, _DDDRes,
    0,
    [_dD, _nT],
    [() => DeliveryDestinations, 0]
];
exports.DescribeDeliverySourcesRequest$ = [3, n0, _DDSRe,
    0,
    [_nT, _li],
    [0, 1]
];
exports.DescribeDeliverySourcesResponse$ = [3, n0, _DDSRes,
    0,
    [_dSe, _nT],
    [() => DeliverySources, 0]
];
exports.DescribeDestinationsRequest$ = [3, n0, _DDRescr,
    0,
    [_DNP, _nT, _li],
    [0, 0, 1]
];
exports.DescribeDestinationsResponse$ = [3, n0, _DDRescri,
    0,
    [_dest, _nT],
    [() => Destinations, 0]
];
exports.DescribeExportTasksRequest$ = [3, n0, _DETR,
    0,
    [_tI, _sCt, _nT, _li],
    [0, 0, 0, 1]
];
exports.DescribeExportTasksResponse$ = [3, n0, _DETRe,
    0,
    [_eT, _nT],
    [() => ExportTasks, 0]
];
exports.DescribeFieldIndexesRequest$ = [3, n0, _DFIR,
    0,
    [_lGI, _nT],
    [64 | 0, 0], 1
];
exports.DescribeFieldIndexesResponse$ = [3, n0, _DFIRe,
    0,
    [_fI, _nT],
    [() => FieldIndexes, 0]
];
exports.DescribeImportTaskBatchesRequest$ = [3, n0, _DITBR,
    0,
    [_iI, _bIS, _li, _nT],
    [0, 64 | 0, 1, 0], 1
];
exports.DescribeImportTaskBatchesResponse$ = [3, n0, _DITBRe,
    0,
    [_iSA, _iI, _iB, _nT],
    [0, 0, () => ImportBatchList, 0]
];
exports.DescribeImportTasksRequest$ = [3, n0, _DITR,
    0,
    [_iI, _iSm, _iSA, _li, _nT],
    [0, 0, 0, 1, 0]
];
exports.DescribeImportTasksResponse$ = [3, n0, _DITRe,
    0,
    [_im, _nT],
    [() => ImportList, 0]
];
exports.DescribeIndexPoliciesRequest$ = [3, n0, _DIPRes,
    0,
    [_lGI, _nT],
    [64 | 0, 0], 1
];
exports.DescribeIndexPoliciesResponse$ = [3, n0, _DIPResc,
    0,
    [_iP, _nT],
    [() => IndexPolicies, 0]
];
exports.DescribeLogGroupsRequest$ = [3, n0, _DLGRe,
    0,
    [_aIc, _lGNP, _lGNPo, _nT, _li, _iLA, _lGCo, _lGI],
    [64 | 0, 0, 0, 0, 1, 2, 0, 64 | 0]
];
exports.DescribeLogGroupsResponse$ = [3, n0, _DLGRes,
    0,
    [_lG, _nT],
    [() => LogGroups, 0]
];
exports.DescribeLogStreamsRequest$ = [3, n0, _DLSRe,
    0,
    [_lGN, _lGIo, _lSNP, _oB, _desc, _nT, _li],
    [0, 0, 0, 0, 2, 0, 1]
];
exports.DescribeLogStreamsResponse$ = [3, n0, _DLSRes,
    0,
    [_lSog, _nT],
    [() => LogStreams, 0]
];
exports.DescribeMetricFiltersRequest$ = [3, n0, _DMFRe,
    0,
    [_lGN, _fNP, _nT, _li, _mN, _mNe],
    [0, 0, 0, 1, 0, 0]
];
exports.DescribeMetricFiltersResponse$ = [3, n0, _DMFRes,
    0,
    [_mF, _nT],
    [() => MetricFilters, 0]
];
exports.DescribeQueriesRequest$ = [3, n0, _DQR,
    0,
    [_lGN, _sta, _mR, _nT, _qL],
    [0, 0, 1, 0, 0]
];
exports.DescribeQueriesResponse$ = [3, n0, _DQRe,
    0,
    [_q, _nT],
    [() => QueryInfoList, 0]
];
exports.DescribeQueryDefinitionsRequest$ = [3, n0, _DQDRes,
    0,
    [_qL, _qDNP, _mR, _nT],
    [0, 0, 1, 0]
];
exports.DescribeQueryDefinitionsResponse$ = [3, n0, _DQDResc,
    0,
    [_qD, _nT],
    [() => QueryDefinitionList, 0]
];
exports.DescribeResourcePoliciesRequest$ = [3, n0, _DRPRes,
    0,
    [_nT, _li, _rA, _pSo],
    [0, 1, 0, 0]
];
exports.DescribeResourcePoliciesResponse$ = [3, n0, _DRPResc,
    0,
    [_rP, _nT],
    [() => ResourcePolicies, 0]
];
exports.DescribeSubscriptionFiltersRequest$ = [3, n0, _DSFRe,
    0,
    [_lGN, _fNP, _nT, _li],
    [0, 0, 0, 1], 1
];
exports.DescribeSubscriptionFiltersResponse$ = [3, n0, _DSFRes,
    0,
    [_sF, _nT],
    [() => SubscriptionFilters, 0]
];
exports.Destination$ = [3, n0, _De,
    0,
    [_dNe, _tA, _rAo, _aPc, _ar, _cT],
    [0, 0, 0, 0, 0, 1]
];
exports.DestinationConfiguration$ = [3, n0, _DC,
    0,
    [_sCo],
    [() => exports.S3Configuration$], 1
];
exports.DisassociateKmsKeyRequest$ = [3, n0, _DKKR,
    0,
    [_lGN, _rI],
    [0, 0]
];
exports.DisassociateSourceFromS3TableIntegrationRequest$ = [3, n0, _DSFSTIR,
    0,
    [_i],
    [0], 1
];
exports.DisassociateSourceFromS3TableIntegrationResponse$ = [3, n0, _DSFSTIRi,
    0,
    [_i],
    [0]
];
exports.Entity$ = [3, n0, _E,
    0,
    [_kA, _at],
    [128 | 0, 128 | 0]
];
exports.ExportTask$ = [3, n0, _ET,
    0,
    [_tI, _tN, _lGN, _f, _to, _des, _dP, _sta, _eI],
    [0, 0, 0, 1, 1, 0, 0, () => exports.ExportTaskStatus$, () => exports.ExportTaskExecutionInfo$]
];
exports.ExportTaskExecutionInfo$ = [3, n0, _ETEI,
    0,
    [_cT, _cTom],
    [1, 1]
];
exports.ExportTaskStatus$ = [3, n0, _ETS,
    0,
    [_cod, _m],
    [0, 0]
];
exports.FieldIndex$ = [3, n0, _FI,
    0,
    [_lGIo, _fIN, _lST, _fET, _lET, _ty],
    [0, 0, 1, 1, 1, 0]
];
exports.FieldsData$ = [3, n0, _FD,
    0,
    [_da],
    [21]
];
exports.FilteredLogEvent$ = [3, n0, _FLE,
    0,
    [_lSN, _tim, _m, _iT, _eIv],
    [0, 1, 0, 1, 0]
];
exports.FilterLogEventsRequest$ = [3, n0, _FLER,
    0,
    [_lGN, _lGIo, _lSNo, _lSNP, _sTt, _eTn, _fP, _nT, _li, _in, _u],
    [0, 0, 64 | 0, 0, 1, 1, 0, 0, 1, 2, 2]
];
exports.FilterLogEventsResponse$ = [3, n0, _FLERi,
    0,
    [_ev, _sLS, _nT],
    [() => FilteredLogEvents, () => SearchedLogStreams, 0]
];
exports.GetDataProtectionPolicyRequest$ = [3, n0, _GDPPR,
    0,
    [_lGIo],
    [0], 1
];
exports.GetDataProtectionPolicyResponse$ = [3, n0, _GDPPRe,
    0,
    [_lGIo, _pD, _lUT],
    [0, 0, 1]
];
exports.GetDeliveryDestinationPolicyRequest$ = [3, n0, _GDDPR,
    0,
    [_dDN],
    [0], 1
];
exports.GetDeliveryDestinationPolicyResponse$ = [3, n0, _GDDPRe,
    0,
    [_po],
    [() => exports.Policy$]
];
exports.GetDeliveryDestinationRequest$ = [3, n0, _GDDR,
    0,
    [_n],
    [0], 1
];
exports.GetDeliveryDestinationResponse$ = [3, n0, _GDDRe,
    0,
    [_dDe],
    [() => exports.DeliveryDestination$]
];
exports.GetDeliveryRequest$ = [3, n0, _GDR,
    0,
    [_id],
    [0], 1
];
exports.GetDeliveryResponse$ = [3, n0, _GDRe,
    0,
    [_de],
    [() => exports.Delivery$]
];
exports.GetDeliverySourceRequest$ = [3, n0, _GDSR,
    0,
    [_n],
    [0], 1
];
exports.GetDeliverySourceResponse$ = [3, n0, _GDSRe,
    0,
    [_dSel],
    [() => exports.DeliverySource$]
];
exports.GetIntegrationRequest$ = [3, n0, _GIR,
    0,
    [_iN],
    [0], 1
];
exports.GetIntegrationResponse$ = [3, n0, _GIRe,
    0,
    [_iN, _iTn, _iSn, _iD],
    [0, 0, 0, () => exports.IntegrationDetails$]
];
exports.GetLogAnomalyDetectorRequest$ = [3, n0, _GLADR,
    0,
    [_aDA],
    [0], 1
];
exports.GetLogAnomalyDetectorResponse$ = [3, n0, _GLADRe,
    0,
    [_dN, _lGAL, _eF, _fP, _aDS, _kKI, _cTS, _lMTS, _aVT],
    [0, 64 | 0, 0, 0, 0, 0, 1, 1, 1]
];
exports.GetLogEventsRequest$ = [3, n0, _GLER,
    0,
    [_lSN, _lGN, _lGIo, _sTt, _eTn, _nT, _li, _sFH, _u],
    [0, 0, 0, 1, 1, 0, 1, 2, 2], 1
];
exports.GetLogEventsResponse$ = [3, n0, _GLERe,
    0,
    [_ev, _nFT, _nBT],
    [() => OutputLogEvents, 0, 0]
];
exports.GetLogFieldsRequest$ = [3, n0, _GLFR,
    0,
    [_dSNa, _dST],
    [0, 0], 2
];
exports.GetLogFieldsResponse$ = [3, n0, _GLFRe,
    0,
    [_lF],
    [() => LogFieldsList]
];
exports.GetLogGroupFieldsRequest$ = [3, n0, _GLGFR,
    0,
    [_lGN, _time, _lGIo],
    [0, 1, 0]
];
exports.GetLogGroupFieldsResponse$ = [3, n0, _GLGFRe,
    0,
    [_lGF],
    [() => LogGroupFieldList]
];
exports.GetLogObjectRequest$ = [3, n0, _GLOR,
    0,
    [_lOP, _u],
    [0, 2], 1
];
exports.GetLogObjectResponse$ = [3, n0, _GLORe,
    0,
    [_fSi],
    [[() => exports.GetLogObjectResponseStream$, 0]]
];
exports.GetLogRecordRequest$ = [3, n0, _GLRR,
    0,
    [_lRP, _u],
    [0, 2], 1
];
exports.GetLogRecordResponse$ = [3, n0, _GLRRe,
    0,
    [_lR],
    [128 | 0]
];
exports.GetQueryResultsRequest$ = [3, n0, _GQRR,
    0,
    [_qI],
    [0], 1
];
exports.GetQueryResultsResponse$ = [3, n0, _GQRRe,
    0,
    [_qL, _r, _stat, _sta, _eK],
    [0, () => QueryResults, () => exports.QueryStatistics$, 0, 0]
];
exports.GetScheduledQueryHistoryRequest$ = [3, n0, _GSQHR,
    0,
    [_i, _sTt, _eTn, _eS, _mR, _nT],
    [0, 1, 1, 64 | 0, 1, 0], 3
];
exports.GetScheduledQueryHistoryResponse$ = [3, n0, _GSQHRe,
    0,
    [_n, _sQA, _tH, _nT],
    [0, 0, () => TriggerHistoryRecordList, 0]
];
exports.GetScheduledQueryRequest$ = [3, n0, _GSQR,
    0,
    [_i],
    [0], 1
];
exports.GetScheduledQueryResponse$ = [3, n0, _GSQRe,
    0,
    [_sQA, _n, _d, _qL, _qS, _lGI, _sE, _ti, _sTO, _dC, _st, _lTT, _lES, _sST, _sET, _eRA, _cT, _lUT],
    [0, 0, 0, 0, 0, 64 | 0, 0, 0, 1, () => exports.DestinationConfiguration$, 0, 1, 0, 1, 1, 0, 1, 1]
];
exports.GetTransformerRequest$ = [3, n0, _GTR,
    0,
    [_lGIo],
    [0], 1
];
exports.GetTransformerResponse$ = [3, n0, _GTRe,
    0,
    [_lGIo, _cT, _lMT, _tC],
    [0, 1, 1, () => Processors]
];
exports.Grok$ = [3, n0, _G,
    0,
    [_ma, _so],
    [0, 0], 1
];
exports.GroupingIdentifier$ = [3, n0, _GI,
    0,
    [_k, _v],
    [0, 0]
];
exports.Import$ = [3, n0, _I,
    0,
    [_iI, _iSA, _iSm, _iDA, _iS, _iF, _cT, _lUT, _eM],
    [0, 0, 0, 0, () => exports.ImportStatistics$, () => exports.ImportFilter$, 1, 1, 0]
];
exports.ImportBatch$ = [3, n0, _IB,
    0,
    [_bI, _sta, _eM],
    [0, 0, 0], 2
];
exports.ImportFilter$ = [3, n0, _IF,
    0,
    [_sETt, _eET],
    [1, 1]
];
exports.ImportStatistics$ = [3, n0, _IS,
    0,
    [_bIy],
    [1]
];
exports.IndexPolicy$ = [3, n0, _IP,
    0,
    [_lGIo, _lUTa, _pD, _pN, _so],
    [0, 1, 0, 0, 0]
];
exports.InputLogEvent$ = [3, n0, _ILE,
    0,
    [_tim, _m],
    [1, 0], 2
];
exports.IntegrationSummary$ = [3, n0, _ISn,
    0,
    [_iN, _iTn, _iSn],
    [0, 0, 0]
];
exports.ListAggregateLogGroupSummariesRequest$ = [3, n0, _LALGSR,
    0,
    [_gB, _aIc, _iLA, _lGCo, _lGNPo, _dSa, _nT, _li],
    [0, 64 | 0, 2, 0, 0, () => DataSourceFilters, 0, 1], 1
];
exports.ListAggregateLogGroupSummariesResponse$ = [3, n0, _LALGSRi,
    0,
    [_aLGS, _nT],
    [() => AggregateLogGroupSummaries, 0]
];
exports.ListAnomaliesRequest$ = [3, n0, _LAR,
    0,
    [_aDA, _sS, _li, _nT],
    [0, 0, 1, 0]
];
exports.ListAnomaliesResponse$ = [3, n0, _LARi,
    0,
    [_an, _nT],
    [() => Anomalies, 0]
];
exports.ListIntegrationsRequest$ = [3, n0, _LIR,
    0,
    [_iNP, _iTn, _iSn],
    [0, 0, 0]
];
exports.ListIntegrationsResponse$ = [3, n0, _LIRi,
    0,
    [_iSnt],
    [() => IntegrationSummaries]
];
exports.ListLogAnomalyDetectorsRequest$ = [3, n0, _LLADR,
    0,
    [_fLGA, _li, _nT],
    [0, 1, 0]
];
exports.ListLogAnomalyDetectorsResponse$ = [3, n0, _LLADRi,
    0,
    [_aD, _nT],
    [() => AnomalyDetectors, 0]
];
exports.ListLogGroupsForQueryRequest$ = [3, n0, _LLGFQR,
    0,
    [_qI, _nT, _mR],
    [0, 0, 1], 1
];
exports.ListLogGroupsForQueryResponse$ = [3, n0, _LLGFQRi,
    0,
    [_lGI, _nT],
    [64 | 0, 0]
];
exports.ListLogGroupsRequest$ = [3, n0, _LLGR,
    0,
    [_lGNPo, _lGCo, _iLA, _aIc, _nT, _li, _dSa, _fINi],
    [0, 0, 2, 64 | 0, 0, 1, () => DataSourceFilters, 64 | 0]
];
exports.ListLogGroupsResponse$ = [3, n0, _LLGRi,
    0,
    [_lG, _nT],
    [() => LogGroupSummaries, 0]
];
exports.ListScheduledQueriesRequest$ = [3, n0, _LSQR,
    0,
    [_mR, _nT, _st],
    [1, 0, 0]
];
exports.ListScheduledQueriesResponse$ = [3, n0, _LSQRi,
    0,
    [_nT, _sQ],
    [0, () => ScheduledQuerySummaryList]
];
exports.ListSourcesForS3TableIntegrationRequest$ = [3, n0, _LSFSTIR,
    0,
    [_iA, _mR, _nT],
    [0, 1, 0], 1
];
exports.ListSourcesForS3TableIntegrationResponse$ = [3, n0, _LSFSTIRi,
    0,
    [_sou, _nT],
    [() => S3TableIntegrationSources, 0]
];
exports.ListTagsForResourceRequest$ = [3, n0, _LTFRR,
    0,
    [_rA],
    [0], 1
];
exports.ListTagsForResourceResponse$ = [3, n0, _LTFRRi,
    0,
    [_ta],
    [128 | 0]
];
exports.ListTagsLogGroupRequest$ = [3, n0, _LTLGR,
    0,
    [_lGN],
    [0], 1
];
exports.ListTagsLogGroupResponse$ = [3, n0, _LTLGRi,
    0,
    [_ta],
    [128 | 0]
];
exports.ListToMap$ = [3, n0, _LTM,
    0,
    [_so, _k, _vK, _t, _fl, _fE],
    [0, 0, 0, 0, 2, 0], 2
];
exports.LiveTailSessionLogEvent$ = [3, n0, _LTSLE,
    0,
    [_lSN, _lGIo, _m, _tim, _iT],
    [0, 0, 0, 1, 1]
];
exports.LiveTailSessionMetadata$ = [3, n0, _LTSM,
    0,
    [_sa],
    [2]
];
exports.LiveTailSessionStart$ = [3, n0, _LTSS,
    0,
    [_rIe, _sI, _lGI, _lSNo, _lSNPo, _lEFP],
    [0, 0, 64 | 0, 64 | 0, 64 | 0, 0]
];
exports.LiveTailSessionUpdate$ = [3, n0, _LTSU,
    0,
    [_sM, _sR],
    [() => exports.LiveTailSessionMetadata$, () => LiveTailSessionResults]
];
exports.LogEvent$ = [3, n0, _LE,
    0,
    [_tim, _m],
    [1, 0]
];
exports.LogFieldsListItem$ = [3, n0, _LFLI,
    0,
    [_lFN, _lFT],
    [0, () => exports.LogFieldType$]
];
exports.LogFieldType$ = [3, n0, _LFT,
    0,
    [_ty, _el, _fi],
    [0, () => exports.LogFieldType$, () => LogFieldsList]
];
exports.LogGroup$ = [3, n0, _LG,
    0,
    [_lGN, _cT, _rID, _mFC, _ar, _sB, _kKI, _dPS, _iPn, _lGCo, _lGA, _dPE, _bTAE],
    [0, 1, 1, 1, 0, 1, 0, 0, 64 | 0, 0, 0, 2, 2]
];
exports.LogGroupField$ = [3, n0, _LGF,
    0,
    [_n, _pe],
    [0, 1]
];
exports.LogGroupSummary$ = [3, n0, _LGS,
    0,
    [_lGN, _lGA, _lGCo],
    [0, 0, 0]
];
exports.LogStream$ = [3, n0, _LS,
    0,
    [_lSN, _cT, _fETi, _lETa, _lIT, _uST, _ar, _sB],
    [0, 1, 1, 1, 1, 0, 0, 1]
];
exports.LowerCaseString$ = [3, n0, _LCS,
    0,
    [_wK],
    [64 | 0], 1
];
exports.MetricFilter$ = [3, n0, _MF,
    0,
    [_fN, _fP, _mT, _cT, _lGN, _aOTL, _fSC, _eSFD],
    [0, 0, () => MetricTransformations, 1, 0, 2, 0, 64 | 0]
];
exports.MetricFilterMatchRecord$ = [3, n0, _MFMR,
    0,
    [_eN, _eMv, _eV],
    [1, 0, 128 | 0]
];
exports.MetricTransformation$ = [3, n0, _MT,
    0,
    [_mN, _mNe, _mV, _dV, _di, _un],
    [0, 0, 0, 1, 128 | 0, 0], 3
];
exports.MoveKeyEntry$ = [3, n0, _MKE,
    0,
    [_so, _t, _oIE],
    [0, 0, 2], 2
];
exports.MoveKeys$ = [3, n0, _MK,
    0,
    [_en],
    [() => MoveKeyEntries], 1
];
exports.OpenSearchApplication$ = [3, n0, _OSA,
    0,
    [_aE, _aA, _aIp, _sta],
    [0, 0, 0, () => exports.OpenSearchResourceStatus$]
];
exports.OpenSearchCollection$ = [3, n0, _OSC,
    0,
    [_cE, _cA, _sta],
    [0, 0, () => exports.OpenSearchResourceStatus$]
];
exports.OpenSearchDataAccessPolicy$ = [3, n0, _OSDAP,
    0,
    [_pN, _sta],
    [0, () => exports.OpenSearchResourceStatus$]
];
exports.OpenSearchDataSource$ = [3, n0, _OSDS,
    0,
    [_dSNa, _sta],
    [0, () => exports.OpenSearchResourceStatus$]
];
exports.OpenSearchEncryptionPolicy$ = [3, n0, _OSEP,
    0,
    [_pN, _sta],
    [0, () => exports.OpenSearchResourceStatus$]
];
exports.OpenSearchIntegrationDetails$ = [3, n0, _OSID,
    0,
    [_dS, _ap, _col, _w, _eP, _nP, _aPc, _lP],
    [() => exports.OpenSearchDataSource$, () => exports.OpenSearchApplication$, () => exports.OpenSearchCollection$, () => exports.OpenSearchWorkspace$, () => exports.OpenSearchEncryptionPolicy$, () => exports.OpenSearchNetworkPolicy$, () => exports.OpenSearchDataAccessPolicy$, () => exports.OpenSearchLifecyclePolicy$]
];
exports.OpenSearchLifecyclePolicy$ = [3, n0, _OSLP,
    0,
    [_pN, _sta],
    [0, () => exports.OpenSearchResourceStatus$]
];
exports.OpenSearchNetworkPolicy$ = [3, n0, _OSNP,
    0,
    [_pN, _sta],
    [0, () => exports.OpenSearchResourceStatus$]
];
exports.OpenSearchResourceConfig$ = [3, n0, _OSRC,
    0,
    [_dSRA, _dVP, _rD, _kKA, _aA],
    [0, 64 | 0, 1, 0, 0], 3
];
exports.OpenSearchResourceStatus$ = [3, n0, _OSRS,
    0,
    [_sta, _sMt],
    [0, 0]
];
exports.OpenSearchWorkspace$ = [3, n0, _OSW,
    0,
    [_wI, _sta],
    [0, () => exports.OpenSearchResourceStatus$]
];
exports.OutputLogEvent$ = [3, n0, _OLE,
    0,
    [_tim, _m, _iT],
    [1, 0, 1]
];
exports.ParseCloudfront$ = [3, n0, _PC,
    0,
    [_so],
    [0]
];
exports.ParseJSON$ = [3, n0, _PJSON,
    0,
    [_so, _des],
    [0, 0]
];
exports.ParseKeyValue$ = [3, n0, _PKV,
    0,
    [_so, _des, _fD, _kVD, _kP, _nMV, _oIE],
    [0, 0, 0, 0, 0, 0, 2]
];
exports.ParsePostgres$ = [3, n0, _PP,
    0,
    [_so],
    [0]
];
exports.ParseRoute53$ = [3, n0, _PR,
    0,
    [_so],
    [0]
];
exports.ParseToOCSF$ = [3, n0, _PTOCSF,
    0,
    [_eSv, _oV, _so, _mVa],
    [0, 0, 0, 0], 2
];
exports.ParseVPC$ = [3, n0, _PVPC,
    0,
    [_so],
    [0]
];
exports.ParseWAF$ = [3, n0, _PWAF,
    0,
    [_so],
    [0]
];
exports.PatternToken$ = [3, n0, _PT,
    0,
    [_dTP, _iDs, _tS, _enu, _iTN],
    [1, 2, 0, 128 | 1, 0]
];
exports.Policy$ = [3, n0, _P,
    0,
    [_dDP],
    [0]
];
exports.Processor$ = [3, n0, _Pr,
    0,
    [_aK, _cV, _cs, _dTC, _dK, _g, _lTM, _lCS, _mK, _pC, _pJSON, _pKV, _pRa, _pTOCSF, _pP, _pVPC, _pWAF, _rK, _sSp, _sSu, _tSr, _tCy, _uCS],
    [() => exports.AddKeys$, () => exports.CopyValue$, () => exports.CSV$, () => exports.DateTimeConverter$, () => exports.DeleteKeys$, () => exports.Grok$, () => exports.ListToMap$, () => exports.LowerCaseString$, () => exports.MoveKeys$, () => exports.ParseCloudfront$, () => exports.ParseJSON$, () => exports.ParseKeyValue$, () => exports.ParseRoute53$, () => exports.ParseToOCSF$, () => exports.ParsePostgres$, () => exports.ParseVPC$, () => exports.ParseWAF$, () => exports.RenameKeys$, () => exports.SplitString$, () => exports.SubstituteString$, () => exports.TrimString$, () => exports.TypeConverter$, () => exports.UpperCaseString$]
];
exports.PutAccountPolicyRequest$ = [3, n0, _PAPR,
    0,
    [_pN, _pD, _pT, _sc, _sC],
    [0, 0, 0, 0, 0], 3
];
exports.PutAccountPolicyResponse$ = [3, n0, _PAPRu,
    0,
    [_aPcc],
    [() => exports.AccountPolicy$]
];
exports.PutBearerTokenAuthenticationRequest$ = [3, n0, _PBTAR,
    0,
    [_lGIo, _bTAE],
    [0, 2], 2
];
exports.PutDataProtectionPolicyRequest$ = [3, n0, _PDPPR,
    0,
    [_lGIo, _pD],
    [0, 0], 2
];
exports.PutDataProtectionPolicyResponse$ = [3, n0, _PDPPRu,
    0,
    [_lGIo, _pD, _lUT],
    [0, 0, 1]
];
exports.PutDeliveryDestinationPolicyRequest$ = [3, n0, _PDDPR,
    0,
    [_dDN, _dDP],
    [0, 0], 2
];
exports.PutDeliveryDestinationPolicyResponse$ = [3, n0, _PDDPRu,
    0,
    [_po],
    [() => exports.Policy$]
];
exports.PutDeliveryDestinationRequest$ = [3, n0, _PDDR,
    0,
    [_n, _oF, _dDC, _dDT, _ta],
    [0, 0, () => exports.DeliveryDestinationConfiguration$, 0, 128 | 0], 1
];
exports.PutDeliveryDestinationResponse$ = [3, n0, _PDDRu,
    0,
    [_dDe],
    [() => exports.DeliveryDestination$]
];
exports.PutDeliverySourceRequest$ = [3, n0, _PDSR,
    0,
    [_n, _rA, _lT, _ta],
    [0, 0, 0, 128 | 0], 3
];
exports.PutDeliverySourceResponse$ = [3, n0, _PDSRu,
    0,
    [_dSel],
    [() => exports.DeliverySource$]
];
exports.PutDestinationPolicyRequest$ = [3, n0, _PDPR,
    0,
    [_dNe, _aPc, _fU],
    [0, 0, 2], 2
];
exports.PutDestinationRequest$ = [3, n0, _PDR,
    0,
    [_dNe, _tA, _rAo, _ta],
    [0, 0, 0, 128 | 0], 3
];
exports.PutDestinationResponse$ = [3, n0, _PDRu,
    0,
    [_des],
    [() => exports.Destination$]
];
exports.PutIndexPolicyRequest$ = [3, n0, _PIPR,
    0,
    [_lGIo, _pD],
    [0, 0], 2
];
exports.PutIndexPolicyResponse$ = [3, n0, _PIPRu,
    0,
    [_iPnd],
    [() => exports.IndexPolicy$]
];
exports.PutIntegrationRequest$ = [3, n0, _PIR,
    0,
    [_iN, _rC, _iTn],
    [0, () => exports.ResourceConfig$, 0], 3
];
exports.PutIntegrationResponse$ = [3, n0, _PIRu,
    0,
    [_iN, _iSn],
    [0, 0]
];
exports.PutLogEventsRequest$ = [3, n0, _PLER,
    0,
    [_lGN, _lSN, _lE, _sTe, _ent],
    [0, 0, () => InputLogEvents, 0, () => exports.Entity$], 3
];
exports.PutLogEventsResponse$ = [3, n0, _PLERu,
    0,
    [_nST, _rLEI, _rEI],
    [0, () => exports.RejectedLogEventsInfo$, () => exports.RejectedEntityInfo$]
];
exports.PutLogGroupDeletionProtectionRequest$ = [3, n0, _PLGDPR,
    0,
    [_lGIo, _dPE],
    [0, 2], 2
];
exports.PutMetricFilterRequest$ = [3, n0, _PMFR,
    0,
    [_lGN, _fN, _fP, _mT, _aOTL, _fSC, _eSFD],
    [0, 0, 0, () => MetricTransformations, 2, 0, 64 | 0], 4
];
exports.PutQueryDefinitionRequest$ = [3, n0, _PQDR,
    0,
    [_n, _qS, _qL, _qDI, _lGNo, _cTl],
    [0, 0, 0, 0, 64 | 0, [0, 4]], 2
];
exports.PutQueryDefinitionResponse$ = [3, n0, _PQDRu,
    0,
    [_qDI],
    [0]
];
exports.PutResourcePolicyRequest$ = [3, n0, _PRPR,
    0,
    [_pN, _pD, _rA, _eRI],
    [0, 0, 0, 0]
];
exports.PutResourcePolicyResponse$ = [3, n0, _PRPRu,
    0,
    [_rPe, _rIev],
    [() => exports.ResourcePolicy$, 0]
];
exports.PutRetentionPolicyRequest$ = [3, n0, _PRPRut,
    0,
    [_lGN, _rID],
    [0, 1], 2
];
exports.PutSubscriptionFilterRequest$ = [3, n0, _PSFR,
    0,
    [_lGN, _fN, _fP, _dA, _rAo, _dis, _aOTL, _fSC, _eSF],
    [0, 0, 0, 0, 0, 0, 2, 0, 64 | 0], 4
];
exports.PutTransformerRequest$ = [3, n0, _PTR,
    0,
    [_lGIo, _tC],
    [0, () => Processors], 2
];
exports.QueryCompileError$ = [3, n0, _QCE,
    0,
    [_lo, _m],
    [() => exports.QueryCompileErrorLocation$, 0]
];
exports.QueryCompileErrorLocation$ = [3, n0, _QCEL,
    0,
    [_sCO, _eCO],
    [1, 1]
];
exports.QueryDefinition$ = [3, n0, _QD,
    0,
    [_qL, _qDI, _n, _qS, _lM, _lGNo],
    [0, 0, 0, 0, 1, 64 | 0]
];
exports.QueryInfo$ = [3, n0, _QI,
    0,
    [_qL, _qI, _qS, _sta, _cTr, _lGN],
    [0, 0, 0, 0, 1, 0]
];
exports.QueryStatistics$ = [3, n0, _QS,
    0,
    [_rM, _rS, _eRS, _bS, _eBS, _lGS],
    [1, 1, 1, 1, 1, 1]
];
exports.RecordField$ = [3, n0, _RF,
    0,
    [_n, _man],
    [0, 2]
];
exports.RejectedEntityInfo$ = [3, n0, _REI,
    0,
    [_eTr],
    [0], 1
];
exports.RejectedLogEventsInfo$ = [3, n0, _RLEI,
    0,
    [_tNLESI, _tOLEEI, _eLEEI],
    [1, 1, 1]
];
exports.RenameKeyEntry$ = [3, n0, _RKE,
    0,
    [_k, _rTen, _oIE],
    [0, 0, 2], 2
];
exports.RenameKeys$ = [3, n0, _RK,
    0,
    [_en],
    [() => RenameKeyEntries], 1
];
exports.ResourcePolicy$ = [3, n0, _RP,
    0,
    [_pN, _pD, _lUT, _pSo, _rA, _rIev],
    [0, 0, 1, 0, 0, 0]
];
exports.ResultField$ = [3, n0, _RFe,
    0,
    [_fie, _v],
    [0, 0]
];
exports.S3Configuration$ = [3, n0, _SC,
    0,
    [_dI, _rAo],
    [0, 0], 2
];
exports.S3DeliveryConfiguration$ = [3, n0, _SDC,
    0,
    [_sP, _eHCP],
    [0, 2]
];
exports.S3TableIntegrationSource$ = [3, n0, _STIS,
    0,
    [_i, _dS, _sta, _sRt, _cTSr],
    [0, () => exports.DataSource$, 0, 0, 1]
];
exports.ScheduledQueryDestination$ = [3, n0, _SQD,
    0,
    [_dT, _dI, _sta, _pIr, _eM],
    [0, 0, 0, 0, 0]
];
exports.ScheduledQuerySummary$ = [3, n0, _SQS,
    0,
    [_sQA, _n, _st, _lTT, _lES, _sE, _ti, _dC, _cT, _lUT],
    [0, 0, 0, 1, 0, 0, 0, () => exports.DestinationConfiguration$, 1, 1]
];
exports.SearchedLogStream$ = [3, n0, _SLS,
    0,
    [_lSN, _sCe],
    [0, 2]
];
exports.SplitString$ = [3, n0, _SS,
    0,
    [_en],
    [() => SplitStringEntries], 1
];
exports.SplitStringEntry$ = [3, n0, _SSEp,
    0,
    [_so, _del],
    [0, 0], 2
];
exports.StartLiveTailRequest$ = [3, n0, _SLTR,
    0,
    [_lGI, _lSNo, _lSNPo, _lEFP],
    [64 | 0, 64 | 0, 64 | 0, 0], 1
];
exports.StartLiveTailResponse$ = [3, n0, _SLTRt,
    0,
    [_rSe],
    [[() => exports.StartLiveTailResponseStream$, 0]]
];
exports.StartQueryRequest$ = [3, n0, _SQR,
    0,
    [_sTt, _eTn, _qS, _qL, _lGN, _lGNo, _lGI, _li],
    [1, 1, 0, 0, 0, 64 | 0, 64 | 0, 1], 3
];
exports.StartQueryResponse$ = [3, n0, _SQRt,
    0,
    [_qI],
    [0]
];
exports.StopQueryRequest$ = [3, n0, _SQRto,
    0,
    [_qI],
    [0], 1
];
exports.StopQueryResponse$ = [3, n0, _SQRtop,
    0,
    [_suc],
    [2]
];
exports.SubscriptionFilter$ = [3, n0, _SF,
    0,
    [_fN, _lGN, _fP, _dA, _rAo, _dis, _aOTL, _cT, _fSC, _eSF],
    [0, 0, 0, 0, 0, 0, 2, 1, 0, 64 | 0]
];
exports.SubstituteString$ = [3, n0, _SSu,
    0,
    [_en],
    [() => SubstituteStringEntries], 1
];
exports.SubstituteStringEntry$ = [3, n0, _SSEu,
    0,
    [_so, _f, _to],
    [0, 0, 0], 3
];
exports.SuppressionPeriod$ = [3, n0, _SP,
    0,
    [_v, _sUu],
    [1, 0]
];
exports.TagLogGroupRequest$ = [3, n0, _TLGR,
    0,
    [_lGN, _ta],
    [0, 128 | 0], 2
];
exports.TagResourceRequest$ = [3, n0, _TRR,
    0,
    [_rA, _ta],
    [0, 128 | 0], 2
];
exports.TestMetricFilterRequest$ = [3, n0, _TMFR,
    0,
    [_fP, _lEM],
    [0, 64 | 0], 2
];
exports.TestMetricFilterResponse$ = [3, n0, _TMFRe,
    0,
    [_mat],
    [() => MetricFilterMatches]
];
exports.TestTransformerRequest$ = [3, n0, _TTR,
    0,
    [_tC, _lEM],
    [() => Processors, 64 | 0], 2
];
exports.TestTransformerResponse$ = [3, n0, _TTRe,
    0,
    [_tL],
    [() => TransformedLogs]
];
exports.TransformedLogRecord$ = [3, n0, _TLR,
    0,
    [_eN, _eMv, _tEM],
    [1, 0, 0]
];
exports.TriggerHistoryRecord$ = [3, n0, _THR,
    0,
    [_qI, _eSx, _tTr, _eM, _dest],
    [0, 0, 1, 0, () => ScheduledQueryDestinationList]
];
exports.TrimString$ = [3, n0, _TS,
    0,
    [_wK],
    [64 | 0], 1
];
exports.TypeConverter$ = [3, n0, _TC,
    0,
    [_en],
    [() => TypeConverterEntries], 1
];
exports.TypeConverterEntry$ = [3, n0, _TCE,
    0,
    [_k, _ty],
    [0, 0], 2
];
exports.UntagLogGroupRequest$ = [3, n0, _ULGR,
    0,
    [_lGN, _ta],
    [0, 64 | 0], 2
];
exports.UntagResourceRequest$ = [3, n0, _URR,
    0,
    [_rA, _tK],
    [0, 64 | 0], 2
];
exports.UpdateAnomalyRequest$ = [3, n0, _UAR,
    0,
    [_aDA, _aIn, _pI, _sTu, _sPu, _b],
    [0, 0, 0, 0, () => exports.SuppressionPeriod$, 2], 1
];
exports.UpdateDeliveryConfigurationRequest$ = [3, n0, _UDCR,
    0,
    [_id, _rF, _fD, _sDC],
    [0, 64 | 0, 0, () => exports.S3DeliveryConfiguration$], 1
];
exports.UpdateDeliveryConfigurationResponse$ = [3, n0, _UDCRp,
    0,
    [],
    []
];
exports.UpdateLogAnomalyDetectorRequest$ = [3, n0, _ULADR,
    0,
    [_aDA, _ena, _eF, _fP, _aVT],
    [0, 2, 0, 0, 1], 2
];
exports.UpdateScheduledQueryRequest$ = [3, n0, _USQR,
    0,
    [_i, _qL, _qS, _sE, _eRA, _d, _lGI, _ti, _sTO, _dC, _sST, _sET, _st],
    [0, 0, 0, 0, 0, 0, 64 | 0, 0, 1, () => exports.DestinationConfiguration$, 1, 1, 0], 5
];
exports.UpdateScheduledQueryResponse$ = [3, n0, _USQRp,
    0,
    [_sQA, _n, _d, _qL, _qS, _lGI, _sE, _ti, _sTO, _dC, _st, _lTT, _lES, _sST, _sET, _eRA, _cT, _lUT],
    [0, 0, 0, 0, 0, 64 | 0, 0, 0, 1, () => exports.DestinationConfiguration$, 0, 1, 0, 1, 1, 0, 1, 1]
];
exports.UpperCaseString$ = [3, n0, _UCS,
    0,
    [_wK],
    [64 | 0], 1
];
var __Unit = "unit";
var AccountIds = (/* unused pure expression or super */ null && (64 | 0));
var AccountPolicies = [1, n0, _APc,
    0, () => exports.AccountPolicy$
];
var AddKeyEntries = [1, n0, _AKEd,
    0, () => exports.AddKeyEntry$
];
var AggregateLogGroupSummaries = [1, n0, _ALGSg,
    0, () => exports.AggregateLogGroupSummary$
];
var AllowedFieldDelimiters = (/* unused pure expression or super */ null && (64 | 0));
var AllowedFields = [1, n0, _AF,
    0, () => exports.RecordField$
];
var Anomalies = [1, n0, _An,
    0, () => exports.Anomaly$
];
var AnomalyDetectors = [1, n0, _ADn,
    0, () => exports.AnomalyDetector$
];
var Columns = (/* unused pure expression or super */ null && (64 | 0));
var ConfigurationTemplates = [1, n0, _CTo,
    0, () => exports.ConfigurationTemplate$
];
var CopyValueEntries = [1, n0, _CVEo,
    0, () => exports.CopyValueEntry$
];
var DashboardViewerPrincipals = (/* unused pure expression or super */ null && (64 | 0));
var DataSourceFilters = [1, n0, _DSFa,
    0, () => exports.DataSourceFilter$
];
var DeleteWithKeys = (/* unused pure expression or super */ null && (64 | 0));
var Deliveries = [1, n0, _Del,
    0, () => exports.Delivery$
];
var DeliveryDestinations = [1, n0, _DDe,
    0, () => exports.DeliveryDestination$
];
var DeliveryDestinationTypes = (/* unused pure expression or super */ null && (64 | 0));
var DeliverySources = [1, n0, _DSel,
    0, () => exports.DeliverySource$
];
var DescribeFieldIndexesLogGroupIdentifiers = (/* unused pure expression or super */ null && (64 | 0));
var DescribeIndexPoliciesLogGroupIdentifiers = (/* unused pure expression or super */ null && (64 | 0));
var DescribeLogGroupsLogGroupIdentifiers = (/* unused pure expression or super */ null && (64 | 0));
var Destinations = [1, n0, _Des,
    0, () => exports.Destination$
];
var EmitSystemFields = (/* unused pure expression or super */ null && (64 | 0));
var ExecutionStatusList = (/* unused pure expression or super */ null && (64 | 0));
var ExportTasks = [1, n0, _ETx,
    0, () => exports.ExportTask$
];
var FieldIndexes = [1, n0, _FIi,
    0, () => exports.FieldIndex$
];
var FieldIndexNames = (/* unused pure expression or super */ null && (64 | 0));
var FilteredLogEvents = [1, n0, _FLEi,
    0, () => exports.FilteredLogEvent$
];
var GroupingIdentifiers = [1, n0, _GIr,
    0, () => exports.GroupingIdentifier$
];
var ImportBatchList = [1, n0, _IBL,
    0, () => exports.ImportBatch$
];
var ImportList = [1, n0, _IL,
    0, () => exports.Import$
];
var ImportStatusList = (/* unused pure expression or super */ null && (64 | 0));
var IndexPolicies = [1, n0, _IPn,
    0, () => exports.IndexPolicy$
];
var InheritedProperties = (/* unused pure expression or super */ null && (64 | 0));
var InputLogEvents = [1, n0, _ILEn,
    0, () => exports.InputLogEvent$
];
var InputLogStreamNames = (/* unused pure expression or super */ null && (64 | 0));
var IntegrationSummaries = [1, n0, _ISnt,
    0, () => exports.IntegrationSummary$
];
var LiveTailSessionResults = [1, n0, _LTSR,
    0, () => exports.LiveTailSessionLogEvent$
];
var LogFieldsList = [1, n0, _LFL,
    0, () => exports.LogFieldsListItem$
];
var LogGroupArnList = (/* unused pure expression or super */ null && (64 | 0));
var LogGroupFieldList = [1, n0, _LGFL,
    0, () => exports.LogGroupField$
];
var LogGroupIdentifiers = (/* unused pure expression or super */ null && (64 | 0));
var LogGroupNames = (/* unused pure expression or super */ null && (64 | 0));
var LogGroups = [1, n0, _LGo,
    0, () => exports.LogGroup$
];
var LogGroupSummaries = [1, n0, _LGSo,
    0, () => exports.LogGroupSummary$
];
var LogSamples = [1, n0, _LSo,
    0, () => exports.LogEvent$
];
var LogStreams = [1, n0, _LSog,
    0, () => exports.LogStream$
];
var LogTypes = (/* unused pure expression or super */ null && (64 | 0));
var LowerCaseStringWithKeys = (/* unused pure expression or super */ null && (64 | 0));
var MatchPatterns = (/* unused pure expression or super */ null && (64 | 0));
var MetricFilterMatches = [1, n0, _MFM,
    0, () => exports.MetricFilterMatchRecord$
];
var MetricFilters = [1, n0, _MFe,
    0, () => exports.MetricFilter$
];
var MetricTransformations = [1, n0, _MTe,
    0, () => exports.MetricTransformation$
];
var MoveKeyEntries = [1, n0, _MKEo,
    0, () => exports.MoveKeyEntry$
];
var OutputFormats = (/* unused pure expression or super */ null && (64 | 0));
var OutputLogEvents = [1, n0, _OLEu,
    0, () => exports.OutputLogEvent$
];
var PatternTokens = [1, n0, _PTa,
    0, () => exports.PatternToken$
];
var Processors = [1, n0, _Pro,
    0, () => exports.Processor$
];
var QueryDefinitionList = [1, n0, _QDL,
    0, () => exports.QueryDefinition$
];
var QueryInfoList = [1, n0, _QIL,
    0, () => exports.QueryInfo$
];
var QueryResults = [1, n0, _QR,
    0, () => ResultRows
];
var RecordFields = (/* unused pure expression or super */ null && (64 | 0));
var RenameKeyEntries = [1, n0, _RKEe,
    0, () => exports.RenameKeyEntry$
];
var ResourceArns = (/* unused pure expression or super */ null && (64 | 0));
var ResourcePolicies = [1, n0, _RPe,
    0, () => exports.ResourcePolicy$
];
var ResourceTypes = (/* unused pure expression or super */ null && (64 | 0));
var ResultRows = [1, n0, _RR,
    0, () => exports.ResultField$
];
var S3TableIntegrationSources = [1, n0, _STISa,
    0, () => exports.S3TableIntegrationSource$
];
var ScheduledQueryDestinationList = [1, n0, _SQDL,
    0, () => exports.ScheduledQueryDestination$
];
var ScheduledQueryLogGroupIdentifiers = (/* unused pure expression or super */ null && (64 | 0));
var ScheduledQuerySummaryList = [1, n0, _SQSL,
    0, () => exports.ScheduledQuerySummary$
];
var SearchedLogStreams = [1, n0, _SLSe,
    0, () => exports.SearchedLogStream$
];
var SplitStringEntries = [1, n0, _SSEpl,
    0, () => exports.SplitStringEntry$
];
var StartLiveTailLogGroupIdentifiers = (/* unused pure expression or super */ null && (64 | 0));
var SubscriptionFilters = [1, n0, _SFu,
    0, () => exports.SubscriptionFilter$
];
var SubstituteStringEntries = [1, n0, _SSEub,
    0, () => exports.SubstituteStringEntry$
];
var TagKeyList = (/* unused pure expression or super */ null && (64 | 0));
var TagList = (/* unused pure expression or super */ null && (64 | 0));
var TestEventMessages = (/* unused pure expression or super */ null && (64 | 0));
var TransformedLogs = [1, n0, _TL,
    0, () => exports.TransformedLogRecord$
];
var TriggerHistoryRecordList = [1, n0, _THRL,
    0, () => exports.TriggerHistoryRecord$
];
var TrimStringWithKeys = (/* unused pure expression or super */ null && (64 | 0));
var TypeConverterEntries = [1, n0, _TCEy,
    0, () => exports.TypeConverterEntry$
];
var UpperCaseStringWithKeys = (/* unused pure expression or super */ null && (64 | 0));
var Dimensions = (/* unused pure expression or super */ null && (128 | 0));
var EntityAttributes = (/* unused pure expression or super */ null && (128 | 0));
var EntityKeyAttributes = (/* unused pure expression or super */ null && (128 | 0));
var Enumerations = (/* unused pure expression or super */ null && (128 | 1));
var ExtractedValues = (/* unused pure expression or super */ null && (128 | 0));
var Histogram = (/* unused pure expression or super */ null && (128 | 1));
var LogRecord = (/* unused pure expression or super */ null && (128 | 0));
var Tags = (/* unused pure expression or super */ null && (128 | 0));
exports.GetLogObjectResponseStream$ = [4, n0, _GLORS,
    { [_str]: 1 },
    [_fi, _ISEn],
    [() => exports.FieldsData$, [() => exports.InternalStreamingException$, 0]]
];
exports.IntegrationDetails$ = [4, n0, _ID,
    0,
    [_oSID],
    [() => exports.OpenSearchIntegrationDetails$]
];
exports.ResourceConfig$ = [4, n0, _RC,
    0,
    [_oSRC],
    [() => exports.OpenSearchResourceConfig$]
];
exports.StartLiveTailResponseStream$ = [4, n0, _SLTRS,
    { [_str]: 1 },
    [_sSe, _sUe, _STE, _SSE],
    [() => exports.LiveTailSessionStart$, () => exports.LiveTailSessionUpdate$, [() => exports.SessionTimeoutException$, 0], [() => exports.SessionStreamingException$, 0]]
];
exports.AssociateKmsKey$ = [9, n0, _AKK,
    0, () => exports.AssociateKmsKeyRequest$, () => __Unit
];
exports.AssociateSourceToS3TableIntegration$ = [9, n0, _ASTSTI,
    0, () => exports.AssociateSourceToS3TableIntegrationRequest$, () => exports.AssociateSourceToS3TableIntegrationResponse$
];
exports.CancelExportTask$ = [9, n0, _CET,
    0, () => exports.CancelExportTaskRequest$, () => __Unit
];
exports.CancelImportTask$ = [9, n0, _CIT,
    0, () => exports.CancelImportTaskRequest$, () => exports.CancelImportTaskResponse$
];
exports.CreateDelivery$ = [9, n0, _CD,
    0, () => exports.CreateDeliveryRequest$, () => exports.CreateDeliveryResponse$
];
exports.CreateExportTask$ = [9, n0, _CETr,
    0, () => exports.CreateExportTaskRequest$, () => exports.CreateExportTaskResponse$
];
exports.CreateImportTask$ = [9, n0, _CITr,
    0, () => exports.CreateImportTaskRequest$, () => exports.CreateImportTaskResponse$
];
exports.CreateLogAnomalyDetector$ = [9, n0, _CLAD,
    0, () => exports.CreateLogAnomalyDetectorRequest$, () => exports.CreateLogAnomalyDetectorResponse$
];
exports.CreateLogGroup$ = [9, n0, _CLG,
    0, () => exports.CreateLogGroupRequest$, () => __Unit
];
exports.CreateLogStream$ = [9, n0, _CLS,
    0, () => exports.CreateLogStreamRequest$, () => __Unit
];
exports.CreateScheduledQuery$ = [9, n0, _CSQ,
    0, () => exports.CreateScheduledQueryRequest$, () => exports.CreateScheduledQueryResponse$
];
exports.DeleteAccountPolicy$ = [9, n0, _DAP,
    0, () => exports.DeleteAccountPolicyRequest$, () => __Unit
];
exports.DeleteDataProtectionPolicy$ = [9, n0, _DDPP,
    0, () => exports.DeleteDataProtectionPolicyRequest$, () => __Unit
];
exports.DeleteDelivery$ = [9, n0, _DDel,
    0, () => exports.DeleteDeliveryRequest$, () => __Unit
];
exports.DeleteDeliveryDestination$ = [9, n0, _DDD,
    0, () => exports.DeleteDeliveryDestinationRequest$, () => __Unit
];
exports.DeleteDeliveryDestinationPolicy$ = [9, n0, _DDDP,
    0, () => exports.DeleteDeliveryDestinationPolicyRequest$, () => __Unit
];
exports.DeleteDeliverySource$ = [9, n0, _DDS,
    0, () => exports.DeleteDeliverySourceRequest$, () => __Unit
];
exports.DeleteDestination$ = [9, n0, _DDele,
    0, () => exports.DeleteDestinationRequest$, () => __Unit
];
exports.DeleteIndexPolicy$ = [9, n0, _DIP,
    0, () => exports.DeleteIndexPolicyRequest$, () => exports.DeleteIndexPolicyResponse$
];
exports.DeleteIntegration$ = [9, n0, _DI,
    0, () => exports.DeleteIntegrationRequest$, () => exports.DeleteIntegrationResponse$
];
exports.DeleteLogAnomalyDetector$ = [9, n0, _DLAD,
    0, () => exports.DeleteLogAnomalyDetectorRequest$, () => __Unit
];
exports.DeleteLogGroup$ = [9, n0, _DLG,
    0, () => exports.DeleteLogGroupRequest$, () => __Unit
];
exports.DeleteLogStream$ = [9, n0, _DLS,
    0, () => exports.DeleteLogStreamRequest$, () => __Unit
];
exports.DeleteMetricFilter$ = [9, n0, _DMF,
    0, () => exports.DeleteMetricFilterRequest$, () => __Unit
];
exports.DeleteQueryDefinition$ = [9, n0, _DQD,
    0, () => exports.DeleteQueryDefinitionRequest$, () => exports.DeleteQueryDefinitionResponse$
];
exports.DeleteResourcePolicy$ = [9, n0, _DRP,
    0, () => exports.DeleteResourcePolicyRequest$, () => __Unit
];
exports.DeleteRetentionPolicy$ = [9, n0, _DRPe,
    0, () => exports.DeleteRetentionPolicyRequest$, () => __Unit
];
exports.DeleteScheduledQuery$ = [9, n0, _DSQ,
    0, () => exports.DeleteScheduledQueryRequest$, () => exports.DeleteScheduledQueryResponse$
];
exports.DeleteSubscriptionFilter$ = [9, n0, _DSFe,
    0, () => exports.DeleteSubscriptionFilterRequest$, () => __Unit
];
exports.DeleteTransformer$ = [9, n0, _DT,
    0, () => exports.DeleteTransformerRequest$, () => __Unit
];
exports.DescribeAccountPolicies$ = [9, n0, _DAPe,
    0, () => exports.DescribeAccountPoliciesRequest$, () => exports.DescribeAccountPoliciesResponse$
];
exports.DescribeConfigurationTemplates$ = [9, n0, _DCT,
    0, () => exports.DescribeConfigurationTemplatesRequest$, () => exports.DescribeConfigurationTemplatesResponse$
];
exports.DescribeDeliveries$ = [9, n0, _DDes,
    0, () => exports.DescribeDeliveriesRequest$, () => exports.DescribeDeliveriesResponse$
];
exports.DescribeDeliveryDestinations$ = [9, n0, _DDDe,
    0, () => exports.DescribeDeliveryDestinationsRequest$, () => exports.DescribeDeliveryDestinationsResponse$
];
exports.DescribeDeliverySources$ = [9, n0, _DDSe,
    0, () => exports.DescribeDeliverySourcesRequest$, () => exports.DescribeDeliverySourcesResponse$
];
exports.DescribeDestinations$ = [9, n0, _DDesc,
    0, () => exports.DescribeDestinationsRequest$, () => exports.DescribeDestinationsResponse$
];
exports.DescribeExportTasks$ = [9, n0, _DET,
    0, () => exports.DescribeExportTasksRequest$, () => exports.DescribeExportTasksResponse$
];
exports.DescribeFieldIndexes$ = [9, n0, _DFI,
    0, () => exports.DescribeFieldIndexesRequest$, () => exports.DescribeFieldIndexesResponse$
];
exports.DescribeImportTaskBatches$ = [9, n0, _DITB,
    0, () => exports.DescribeImportTaskBatchesRequest$, () => exports.DescribeImportTaskBatchesResponse$
];
exports.DescribeImportTasks$ = [9, n0, _DIT,
    0, () => exports.DescribeImportTasksRequest$, () => exports.DescribeImportTasksResponse$
];
exports.DescribeIndexPolicies$ = [9, n0, _DIPe,
    0, () => exports.DescribeIndexPoliciesRequest$, () => exports.DescribeIndexPoliciesResponse$
];
exports.DescribeLogGroups$ = [9, n0, _DLGe,
    0, () => exports.DescribeLogGroupsRequest$, () => exports.DescribeLogGroupsResponse$
];
exports.DescribeLogStreams$ = [9, n0, _DLSe,
    0, () => exports.DescribeLogStreamsRequest$, () => exports.DescribeLogStreamsResponse$
];
exports.DescribeMetricFilters$ = [9, n0, _DMFe,
    0, () => exports.DescribeMetricFiltersRequest$, () => exports.DescribeMetricFiltersResponse$
];
exports.DescribeQueries$ = [9, n0, _DQ,
    0, () => exports.DescribeQueriesRequest$, () => exports.DescribeQueriesResponse$
];
exports.DescribeQueryDefinitions$ = [9, n0, _DQDe,
    0, () => exports.DescribeQueryDefinitionsRequest$, () => exports.DescribeQueryDefinitionsResponse$
];
exports.DescribeResourcePolicies$ = [9, n0, _DRPes,
    0, () => exports.DescribeResourcePoliciesRequest$, () => exports.DescribeResourcePoliciesResponse$
];
exports.DescribeSubscriptionFilters$ = [9, n0, _DSFes,
    0, () => exports.DescribeSubscriptionFiltersRequest$, () => exports.DescribeSubscriptionFiltersResponse$
];
exports.DisassociateKmsKey$ = [9, n0, _DKK,
    0, () => exports.DisassociateKmsKeyRequest$, () => __Unit
];
exports.DisassociateSourceFromS3TableIntegration$ = [9, n0, _DSFSTI,
    0, () => exports.DisassociateSourceFromS3TableIntegrationRequest$, () => exports.DisassociateSourceFromS3TableIntegrationResponse$
];
exports.FilterLogEvents$ = [9, n0, _FLEil,
    0, () => exports.FilterLogEventsRequest$, () => exports.FilterLogEventsResponse$
];
exports.GetDataProtectionPolicy$ = [9, n0, _GDPP,
    0, () => exports.GetDataProtectionPolicyRequest$, () => exports.GetDataProtectionPolicyResponse$
];
exports.GetDelivery$ = [9, n0, _GD,
    0, () => exports.GetDeliveryRequest$, () => exports.GetDeliveryResponse$
];
exports.GetDeliveryDestination$ = [9, n0, _GDD,
    0, () => exports.GetDeliveryDestinationRequest$, () => exports.GetDeliveryDestinationResponse$
];
exports.GetDeliveryDestinationPolicy$ = [9, n0, _GDDP,
    0, () => exports.GetDeliveryDestinationPolicyRequest$, () => exports.GetDeliveryDestinationPolicyResponse$
];
exports.GetDeliverySource$ = [9, n0, _GDS,
    0, () => exports.GetDeliverySourceRequest$, () => exports.GetDeliverySourceResponse$
];
exports.GetIntegration$ = [9, n0, _GIe,
    0, () => exports.GetIntegrationRequest$, () => exports.GetIntegrationResponse$
];
exports.GetLogAnomalyDetector$ = [9, n0, _GLAD,
    0, () => exports.GetLogAnomalyDetectorRequest$, () => exports.GetLogAnomalyDetectorResponse$
];
exports.GetLogEvents$ = [9, n0, _GLE,
    0, () => exports.GetLogEventsRequest$, () => exports.GetLogEventsResponse$
];
exports.GetLogFields$ = [9, n0, _GLF,
    0, () => exports.GetLogFieldsRequest$, () => exports.GetLogFieldsResponse$
];
exports.GetLogGroupFields$ = [9, n0, _GLGF,
    0, () => exports.GetLogGroupFieldsRequest$, () => exports.GetLogGroupFieldsResponse$
];
exports.GetLogObject$ = [9, n0, _GLO,
    { [_end]: ["streaming-"] }, () => exports.GetLogObjectRequest$, () => exports.GetLogObjectResponse$
];
exports.GetLogRecord$ = [9, n0, _GLR,
    0, () => exports.GetLogRecordRequest$, () => exports.GetLogRecordResponse$
];
exports.GetQueryResults$ = [9, n0, _GQR,
    0, () => exports.GetQueryResultsRequest$, () => exports.GetQueryResultsResponse$
];
exports.GetScheduledQuery$ = [9, n0, _GSQ,
    0, () => exports.GetScheduledQueryRequest$, () => exports.GetScheduledQueryResponse$
];
exports.GetScheduledQueryHistory$ = [9, n0, _GSQH,
    0, () => exports.GetScheduledQueryHistoryRequest$, () => exports.GetScheduledQueryHistoryResponse$
];
exports.GetTransformer$ = [9, n0, _GT,
    0, () => exports.GetTransformerRequest$, () => exports.GetTransformerResponse$
];
exports.ListAggregateLogGroupSummaries$ = [9, n0, _LALGS,
    0, () => exports.ListAggregateLogGroupSummariesRequest$, () => exports.ListAggregateLogGroupSummariesResponse$
];
exports.ListAnomalies$ = [9, n0, _LA,
    0, () => exports.ListAnomaliesRequest$, () => exports.ListAnomaliesResponse$
];
exports.ListIntegrations$ = [9, n0, _LI,
    0, () => exports.ListIntegrationsRequest$, () => exports.ListIntegrationsResponse$
];
exports.ListLogAnomalyDetectors$ = [9, n0, _LLAD,
    0, () => exports.ListLogAnomalyDetectorsRequest$, () => exports.ListLogAnomalyDetectorsResponse$
];
exports.ListLogGroups$ = [9, n0, _LLG,
    0, () => exports.ListLogGroupsRequest$, () => exports.ListLogGroupsResponse$
];
exports.ListLogGroupsForQuery$ = [9, n0, _LLGFQ,
    0, () => exports.ListLogGroupsForQueryRequest$, () => exports.ListLogGroupsForQueryResponse$
];
exports.ListScheduledQueries$ = [9, n0, _LSQ,
    0, () => exports.ListScheduledQueriesRequest$, () => exports.ListScheduledQueriesResponse$
];
exports.ListSourcesForS3TableIntegration$ = [9, n0, _LSFSTI,
    0, () => exports.ListSourcesForS3TableIntegrationRequest$, () => exports.ListSourcesForS3TableIntegrationResponse$
];
exports.ListTagsForResource$ = [9, n0, _LTFR,
    0, () => exports.ListTagsForResourceRequest$, () => exports.ListTagsForResourceResponse$
];
exports.ListTagsLogGroup$ = [9, n0, _LTLG,
    0, () => exports.ListTagsLogGroupRequest$, () => exports.ListTagsLogGroupResponse$
];
exports.PutAccountPolicy$ = [9, n0, _PAP,
    0, () => exports.PutAccountPolicyRequest$, () => exports.PutAccountPolicyResponse$
];
exports.PutBearerTokenAuthentication$ = [9, n0, _PBTA,
    0, () => exports.PutBearerTokenAuthenticationRequest$, () => __Unit
];
exports.PutDataProtectionPolicy$ = [9, n0, _PDPP,
    0, () => exports.PutDataProtectionPolicyRequest$, () => exports.PutDataProtectionPolicyResponse$
];
exports.PutDeliveryDestination$ = [9, n0, _PDD,
    0, () => exports.PutDeliveryDestinationRequest$, () => exports.PutDeliveryDestinationResponse$
];
exports.PutDeliveryDestinationPolicy$ = [9, n0, _PDDP,
    0, () => exports.PutDeliveryDestinationPolicyRequest$, () => exports.PutDeliveryDestinationPolicyResponse$
];
exports.PutDeliverySource$ = [9, n0, _PDS,
    0, () => exports.PutDeliverySourceRequest$, () => exports.PutDeliverySourceResponse$
];
exports.PutDestination$ = [9, n0, _PD,
    0, () => exports.PutDestinationRequest$, () => exports.PutDestinationResponse$
];
exports.PutDestinationPolicy$ = [9, n0, _PDP,
    0, () => exports.PutDestinationPolicyRequest$, () => __Unit
];
exports.PutIndexPolicy$ = [9, n0, _PIP,
    0, () => exports.PutIndexPolicyRequest$, () => exports.PutIndexPolicyResponse$
];
exports.PutIntegration$ = [9, n0, _PI,
    0, () => exports.PutIntegrationRequest$, () => exports.PutIntegrationResponse$
];
exports.PutLogEvents$ = [9, n0, _PLE,
    0, () => exports.PutLogEventsRequest$, () => exports.PutLogEventsResponse$
];
exports.PutLogGroupDeletionProtection$ = [9, n0, _PLGDP,
    0, () => exports.PutLogGroupDeletionProtectionRequest$, () => __Unit
];
exports.PutMetricFilter$ = [9, n0, _PMF,
    0, () => exports.PutMetricFilterRequest$, () => __Unit
];
exports.PutQueryDefinition$ = [9, n0, _PQD,
    0, () => exports.PutQueryDefinitionRequest$, () => exports.PutQueryDefinitionResponse$
];
exports.PutResourcePolicy$ = [9, n0, _PRP,
    0, () => exports.PutResourcePolicyRequest$, () => exports.PutResourcePolicyResponse$
];
exports.PutRetentionPolicy$ = [9, n0, _PRPu,
    0, () => exports.PutRetentionPolicyRequest$, () => __Unit
];
exports.PutSubscriptionFilter$ = [9, n0, _PSF,
    0, () => exports.PutSubscriptionFilterRequest$, () => __Unit
];
exports.PutTransformer$ = [9, n0, _PTu,
    0, () => exports.PutTransformerRequest$, () => __Unit
];
exports.StartLiveTail$ = [9, n0, _SLT,
    { [_end]: ["streaming-"] }, () => exports.StartLiveTailRequest$, () => exports.StartLiveTailResponse$
];
exports.StartQuery$ = [9, n0, _SQ,
    0, () => exports.StartQueryRequest$, () => exports.StartQueryResponse$
];
exports.StopQuery$ = [9, n0, _SQt,
    0, () => exports.StopQueryRequest$, () => exports.StopQueryResponse$
];
exports.TagLogGroup$ = [9, n0, _TLG,
    0, () => exports.TagLogGroupRequest$, () => __Unit
];
exports.TagResource$ = [9, n0, _TR,
    0, () => exports.TagResourceRequest$, () => __Unit
];
exports.TestMetricFilter$ = [9, n0, _TMF,
    0, () => exports.TestMetricFilterRequest$, () => exports.TestMetricFilterResponse$
];
exports.TestTransformer$ = [9, n0, _TT,
    0, () => exports.TestTransformerRequest$, () => exports.TestTransformerResponse$
];
exports.UntagLogGroup$ = [9, n0, _ULG,
    0, () => exports.UntagLogGroupRequest$, () => __Unit
];
exports.UntagResource$ = [9, n0, _UR,
    0, () => exports.UntagResourceRequest$, () => __Unit
];
exports.UpdateAnomaly$ = [9, n0, _UA,
    0, () => exports.UpdateAnomalyRequest$, () => __Unit
];
exports.UpdateDeliveryConfiguration$ = [9, n0, _UDC,
    0, () => exports.UpdateDeliveryConfigurationRequest$, () => exports.UpdateDeliveryConfigurationResponse$
];
exports.UpdateLogAnomalyDetector$ = [9, n0, _ULAD,
    0, () => exports.UpdateLogAnomalyDetectorRequest$, () => __Unit
];
exports.UpdateScheduledQuery$ = [9, n0, _USQ,
    0, () => exports.UpdateScheduledQueryRequest$, () => exports.UpdateScheduledQueryResponse$
];


/***/ }),

/***/ 96650:
/***/ ((module) => {

module.exports = /*#__PURE__*/JSON.parse('{"name":"@aws-sdk/client-cloudwatch-logs","description":"AWS SDK for JavaScript Cloudwatch Logs Client for Node.js, Browser and React Native","version":"3.1004.0","scripts":{"build":"concurrently \'yarn:build:types\' \'yarn:build:es\' && yarn build:cjs","build:cjs":"node ../../scripts/compilation/inline client-cloudwatch-logs","build:es":"tsc -p tsconfig.es.json","build:include:deps":"yarn g:turbo run build -F=\\"$npm_package_name\\"","build:types":"tsc -p tsconfig.types.json","build:types:downlevel":"downlevel-dts dist-types dist-types/ts3.4","clean":"premove dist-cjs dist-es dist-types tsconfig.cjs.tsbuildinfo tsconfig.es.tsbuildinfo tsconfig.types.tsbuildinfo","extract:docs":"api-extractor run --local","generate:client":"node ../../scripts/generate-clients/single-service --solo cloudwatch-logs","test":"yarn g:vitest run --passWithNoTests","test:e2e":"yarn g:vitest run -c vitest.config.e2e.mts","test:e2e:watch":"yarn g:vitest watch -c vitest.config.e2e.mts","test:index":"tsc --noEmit ./test/index-types.ts && node ./test/index-objects.spec.mjs","test:integration":"yarn g:vitest run --passWithNoTests -c vitest.config.integ.mts","test:integration:watch":"yarn g:vitest run --passWithNoTests -c vitest.config.integ.mts","test:watch":"yarn g:vitest watch --passWithNoTests"},"main":"./dist-cjs/index.js","types":"./dist-types/index.d.ts","module":"./dist-es/index.js","sideEffects":false,"dependencies":{"@aws-crypto/sha256-browser":"5.2.0","@aws-crypto/sha256-js":"5.2.0","@aws-sdk/core":"^3.973.18","@aws-sdk/credential-provider-node":"^3.972.18","@aws-sdk/middleware-host-header":"^3.972.7","@aws-sdk/middleware-logger":"^3.972.7","@aws-sdk/middleware-recursion-detection":"^3.972.7","@aws-sdk/middleware-user-agent":"^3.972.19","@aws-sdk/region-config-resolver":"^3.972.7","@aws-sdk/types":"^3.973.5","@aws-sdk/util-endpoints":"^3.996.4","@aws-sdk/util-user-agent-browser":"^3.972.7","@aws-sdk/util-user-agent-node":"^3.973.4","@smithy/config-resolver":"^4.4.10","@smithy/core":"^3.23.8","@smithy/eventstream-serde-browser":"^4.2.11","@smithy/eventstream-serde-config-resolver":"^4.3.11","@smithy/eventstream-serde-node":"^4.2.11","@smithy/fetch-http-handler":"^5.3.13","@smithy/hash-node":"^4.2.11","@smithy/invalid-dependency":"^4.2.11","@smithy/middleware-content-length":"^4.2.11","@smithy/middleware-endpoint":"^4.4.22","@smithy/middleware-retry":"^4.4.39","@smithy/middleware-serde":"^4.2.12","@smithy/middleware-stack":"^4.2.11","@smithy/node-config-provider":"^4.3.11","@smithy/node-http-handler":"^4.4.14","@smithy/protocol-http":"^5.3.11","@smithy/smithy-client":"^4.12.2","@smithy/types":"^4.13.0","@smithy/url-parser":"^4.2.11","@smithy/util-base64":"^4.3.2","@smithy/util-body-length-browser":"^4.2.2","@smithy/util-body-length-node":"^4.2.3","@smithy/util-defaults-mode-browser":"^4.3.38","@smithy/util-defaults-mode-node":"^4.2.41","@smithy/util-endpoints":"^3.3.2","@smithy/util-middleware":"^4.2.11","@smithy/util-retry":"^4.2.11","@smithy/util-utf8":"^4.2.2","tslib":"^2.6.2"},"devDependencies":{"@smithy/snapshot-testing":"^1.0.9","@tsconfig/node20":"20.1.8","@types/node":"^20.14.8","concurrently":"7.0.0","downlevel-dts":"0.10.1","premove":"4.0.0","typescript":"~5.8.3","vitest":"^4.0.17"},"engines":{"node":">=20.0.0"},"typesVersions":{"<4.5":{"dist-types/*":["dist-types/ts3.4/*"]}},"files":["dist-*/**"],"author":{"name":"AWS SDK for JavaScript Team","url":"https://aws.amazon.com/javascript/"},"license":"Apache-2.0","browser":{"./dist-es/runtimeConfig":"./dist-es/runtimeConfig.browser"},"react-native":{"./dist-es/runtimeConfig":"./dist-es/runtimeConfig.native"},"homepage":"https://github.com/aws/aws-sdk-js-v3/tree/main/clients/client-cloudwatch-logs","repository":{"type":"git","url":"https://github.com/aws/aws-sdk-js-v3.git","directory":"clients/client-cloudwatch-logs"}}');

/***/ })

};

//# sourceMappingURL=107.index.js.map