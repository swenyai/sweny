export const id = 299;
export const ids = [299];
export const modules = {

/***/ 53825:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


// Copyright Amazon.com Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.AwsCrc32c = void 0;
var tslib_1 = __webpack_require__(94176);
var util_1 = __webpack_require__(15103);
var index_1 = __webpack_require__(43655);
var AwsCrc32c = /** @class */ (function () {
    function AwsCrc32c() {
        this.crc32c = new index_1.Crc32c();
    }
    AwsCrc32c.prototype.update = function (toHash) {
        if ((0, util_1.isEmptyData)(toHash))
            return;
        this.crc32c.update((0, util_1.convertToBuffer)(toHash));
    };
    AwsCrc32c.prototype.digest = function () {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            return tslib_1.__generator(this, function (_a) {
                return [2 /*return*/, (0, util_1.numToUint8)(this.crc32c.digest())];
            });
        });
    };
    AwsCrc32c.prototype.reset = function () {
        this.crc32c = new index_1.Crc32c();
    };
    return AwsCrc32c;
}());
exports.AwsCrc32c = AwsCrc32c;
//# sourceMappingURL=aws_crc32c.js.map

/***/ }),

/***/ 43655:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


// Copyright Amazon.com Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.AwsCrc32c = exports.Crc32c = exports.crc32c = void 0;
var tslib_1 = __webpack_require__(94176);
var util_1 = __webpack_require__(15103);
function crc32c(data) {
    return new Crc32c().update(data).digest();
}
exports.crc32c = crc32c;
var Crc32c = /** @class */ (function () {
    function Crc32c() {
        this.checksum = 0xffffffff;
    }
    Crc32c.prototype.update = function (data) {
        var e_1, _a;
        try {
            for (var data_1 = tslib_1.__values(data), data_1_1 = data_1.next(); !data_1_1.done; data_1_1 = data_1.next()) {
                var byte = data_1_1.value;
                this.checksum =
                    (this.checksum >>> 8) ^ lookupTable[(this.checksum ^ byte) & 0xff];
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (data_1_1 && !data_1_1.done && (_a = data_1.return)) _a.call(data_1);
            }
            finally { if (e_1) throw e_1.error; }
        }
        return this;
    };
    Crc32c.prototype.digest = function () {
        return (this.checksum ^ 0xffffffff) >>> 0;
    };
    return Crc32c;
}());
exports.Crc32c = Crc32c;
// prettier-ignore
var a_lookupTable = [
    0x00000000, 0xF26B8303, 0xE13B70F7, 0x1350F3F4, 0xC79A971F, 0x35F1141C, 0x26A1E7E8, 0xD4CA64EB,
    0x8AD958CF, 0x78B2DBCC, 0x6BE22838, 0x9989AB3B, 0x4D43CFD0, 0xBF284CD3, 0xAC78BF27, 0x5E133C24,
    0x105EC76F, 0xE235446C, 0xF165B798, 0x030E349B, 0xD7C45070, 0x25AFD373, 0x36FF2087, 0xC494A384,
    0x9A879FA0, 0x68EC1CA3, 0x7BBCEF57, 0x89D76C54, 0x5D1D08BF, 0xAF768BBC, 0xBC267848, 0x4E4DFB4B,
    0x20BD8EDE, 0xD2D60DDD, 0xC186FE29, 0x33ED7D2A, 0xE72719C1, 0x154C9AC2, 0x061C6936, 0xF477EA35,
    0xAA64D611, 0x580F5512, 0x4B5FA6E6, 0xB93425E5, 0x6DFE410E, 0x9F95C20D, 0x8CC531F9, 0x7EAEB2FA,
    0x30E349B1, 0xC288CAB2, 0xD1D83946, 0x23B3BA45, 0xF779DEAE, 0x05125DAD, 0x1642AE59, 0xE4292D5A,
    0xBA3A117E, 0x4851927D, 0x5B016189, 0xA96AE28A, 0x7DA08661, 0x8FCB0562, 0x9C9BF696, 0x6EF07595,
    0x417B1DBC, 0xB3109EBF, 0xA0406D4B, 0x522BEE48, 0x86E18AA3, 0x748A09A0, 0x67DAFA54, 0x95B17957,
    0xCBA24573, 0x39C9C670, 0x2A993584, 0xD8F2B687, 0x0C38D26C, 0xFE53516F, 0xED03A29B, 0x1F682198,
    0x5125DAD3, 0xA34E59D0, 0xB01EAA24, 0x42752927, 0x96BF4DCC, 0x64D4CECF, 0x77843D3B, 0x85EFBE38,
    0xDBFC821C, 0x2997011F, 0x3AC7F2EB, 0xC8AC71E8, 0x1C661503, 0xEE0D9600, 0xFD5D65F4, 0x0F36E6F7,
    0x61C69362, 0x93AD1061, 0x80FDE395, 0x72966096, 0xA65C047D, 0x5437877E, 0x4767748A, 0xB50CF789,
    0xEB1FCBAD, 0x197448AE, 0x0A24BB5A, 0xF84F3859, 0x2C855CB2, 0xDEEEDFB1, 0xCDBE2C45, 0x3FD5AF46,
    0x7198540D, 0x83F3D70E, 0x90A324FA, 0x62C8A7F9, 0xB602C312, 0x44694011, 0x5739B3E5, 0xA55230E6,
    0xFB410CC2, 0x092A8FC1, 0x1A7A7C35, 0xE811FF36, 0x3CDB9BDD, 0xCEB018DE, 0xDDE0EB2A, 0x2F8B6829,
    0x82F63B78, 0x709DB87B, 0x63CD4B8F, 0x91A6C88C, 0x456CAC67, 0xB7072F64, 0xA457DC90, 0x563C5F93,
    0x082F63B7, 0xFA44E0B4, 0xE9141340, 0x1B7F9043, 0xCFB5F4A8, 0x3DDE77AB, 0x2E8E845F, 0xDCE5075C,
    0x92A8FC17, 0x60C37F14, 0x73938CE0, 0x81F80FE3, 0x55326B08, 0xA759E80B, 0xB4091BFF, 0x466298FC,
    0x1871A4D8, 0xEA1A27DB, 0xF94AD42F, 0x0B21572C, 0xDFEB33C7, 0x2D80B0C4, 0x3ED04330, 0xCCBBC033,
    0xA24BB5A6, 0x502036A5, 0x4370C551, 0xB11B4652, 0x65D122B9, 0x97BAA1BA, 0x84EA524E, 0x7681D14D,
    0x2892ED69, 0xDAF96E6A, 0xC9A99D9E, 0x3BC21E9D, 0xEF087A76, 0x1D63F975, 0x0E330A81, 0xFC588982,
    0xB21572C9, 0x407EF1CA, 0x532E023E, 0xA145813D, 0x758FE5D6, 0x87E466D5, 0x94B49521, 0x66DF1622,
    0x38CC2A06, 0xCAA7A905, 0xD9F75AF1, 0x2B9CD9F2, 0xFF56BD19, 0x0D3D3E1A, 0x1E6DCDEE, 0xEC064EED,
    0xC38D26C4, 0x31E6A5C7, 0x22B65633, 0xD0DDD530, 0x0417B1DB, 0xF67C32D8, 0xE52CC12C, 0x1747422F,
    0x49547E0B, 0xBB3FFD08, 0xA86F0EFC, 0x5A048DFF, 0x8ECEE914, 0x7CA56A17, 0x6FF599E3, 0x9D9E1AE0,
    0xD3D3E1AB, 0x21B862A8, 0x32E8915C, 0xC083125F, 0x144976B4, 0xE622F5B7, 0xF5720643, 0x07198540,
    0x590AB964, 0xAB613A67, 0xB831C993, 0x4A5A4A90, 0x9E902E7B, 0x6CFBAD78, 0x7FAB5E8C, 0x8DC0DD8F,
    0xE330A81A, 0x115B2B19, 0x020BD8ED, 0xF0605BEE, 0x24AA3F05, 0xD6C1BC06, 0xC5914FF2, 0x37FACCF1,
    0x69E9F0D5, 0x9B8273D6, 0x88D28022, 0x7AB90321, 0xAE7367CA, 0x5C18E4C9, 0x4F48173D, 0xBD23943E,
    0xF36E6F75, 0x0105EC76, 0x12551F82, 0xE03E9C81, 0x34F4F86A, 0xC69F7B69, 0xD5CF889D, 0x27A40B9E,
    0x79B737BA, 0x8BDCB4B9, 0x988C474D, 0x6AE7C44E, 0xBE2DA0A5, 0x4C4623A6, 0x5F16D052, 0xAD7D5351,
];
var lookupTable = (0, util_1.uint32ArrayFrom)(a_lookupTable);
var aws_crc32c_1 = __webpack_require__(53825);
Object.defineProperty(exports, "AwsCrc32c", ({ enumerable: true, get: function () { return aws_crc32c_1.AwsCrc32c; } }));
//# sourceMappingURL=index.js.map

/***/ }),

/***/ 10340:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.resolveHttpAuthSchemeConfig = exports.defaultS3HttpAuthSchemeProvider = exports.defaultS3HttpAuthSchemeParametersProvider = void 0;
const core_1 = __webpack_require__(39116);
const signature_v4_multi_region_1 = __webpack_require__(96861);
const middleware_endpoint_1 = __webpack_require__(10775);
const util_middleware_1 = __webpack_require__(54160);
const endpointResolver_1 = __webpack_require__(75898);
const createEndpointRuleSetHttpAuthSchemeParametersProvider = (defaultHttpAuthSchemeParametersProvider) => async (config, context, input) => {
    if (!input) {
        throw new Error("Could not find `input` for `defaultEndpointRuleSetHttpAuthSchemeParametersProvider`");
    }
    const defaultParameters = await defaultHttpAuthSchemeParametersProvider(config, context, input);
    const instructionsFn = (0, util_middleware_1.getSmithyContext)(context)?.commandInstance?.constructor
        ?.getEndpointParameterInstructions;
    if (!instructionsFn) {
        throw new Error(`getEndpointParameterInstructions() is not defined on '${context.commandName}'`);
    }
    const endpointParameters = await (0, middleware_endpoint_1.resolveParams)(input, { getEndpointParameterInstructions: instructionsFn }, config);
    return Object.assign(defaultParameters, endpointParameters);
};
const _defaultS3HttpAuthSchemeParametersProvider = async (config, context, input) => {
    return {
        operation: (0, util_middleware_1.getSmithyContext)(context).operation,
        region: await (0, util_middleware_1.normalizeProvider)(config.region)() || (() => {
            throw new Error("expected `region` to be configured for `aws.auth#sigv4`");
        })(),
    };
};
exports.defaultS3HttpAuthSchemeParametersProvider = createEndpointRuleSetHttpAuthSchemeParametersProvider(_defaultS3HttpAuthSchemeParametersProvider);
function createAwsAuthSigv4HttpAuthOption(authParameters) {
    return {
        schemeId: "aws.auth#sigv4",
        signingProperties: {
            name: "s3",
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
function createAwsAuthSigv4aHttpAuthOption(authParameters) {
    return {
        schemeId: "aws.auth#sigv4a",
        signingProperties: {
            name: "s3",
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
const createEndpointRuleSetHttpAuthSchemeProvider = (defaultEndpointResolver, defaultHttpAuthSchemeResolver, createHttpAuthOptionFunctions) => {
    const endpointRuleSetHttpAuthSchemeProvider = (authParameters) => {
        const endpoint = defaultEndpointResolver(authParameters);
        const authSchemes = endpoint.properties?.authSchemes;
        if (!authSchemes) {
            return defaultHttpAuthSchemeResolver(authParameters);
        }
        const options = [];
        for (const scheme of authSchemes) {
            const { name: resolvedName, properties = {}, ...rest } = scheme;
            const name = resolvedName.toLowerCase();
            if (resolvedName !== name) {
                console.warn(`HttpAuthScheme has been normalized with lowercasing: '${resolvedName}' to '${name}'`);
            }
            let schemeId;
            if (name === "sigv4a") {
                schemeId = "aws.auth#sigv4a";
                const sigv4Present = authSchemes.find((s) => {
                    const name = s.name.toLowerCase();
                    return name !== "sigv4a" && name.startsWith("sigv4");
                });
                if (signature_v4_multi_region_1.SignatureV4MultiRegion.sigv4aDependency() === "none" && sigv4Present) {
                    continue;
                }
            }
            else if (name.startsWith("sigv4")) {
                schemeId = "aws.auth#sigv4";
            }
            else {
                throw new Error(`Unknown HttpAuthScheme found in '@smithy.rules#endpointRuleSet': '${name}'`);
            }
            const createOption = createHttpAuthOptionFunctions[schemeId];
            if (!createOption) {
                throw new Error(`Could not find HttpAuthOption create function for '${schemeId}'`);
            }
            const option = createOption(authParameters);
            option.schemeId = schemeId;
            option.signingProperties = { ...(option.signingProperties || {}), ...rest, ...properties };
            options.push(option);
        }
        return options;
    };
    return endpointRuleSetHttpAuthSchemeProvider;
};
const _defaultS3HttpAuthSchemeProvider = (authParameters) => {
    const options = [];
    switch (authParameters.operation) {
        default: {
            options.push(createAwsAuthSigv4HttpAuthOption(authParameters));
            options.push(createAwsAuthSigv4aHttpAuthOption(authParameters));
        }
    }
    return options;
};
exports.defaultS3HttpAuthSchemeProvider = createEndpointRuleSetHttpAuthSchemeProvider(endpointResolver_1.defaultEndpointResolver, _defaultS3HttpAuthSchemeProvider, {
    "aws.auth#sigv4": createAwsAuthSigv4HttpAuthOption,
    "aws.auth#sigv4a": createAwsAuthSigv4aHttpAuthOption,
});
const resolveHttpAuthSchemeConfig = (config) => {
    const config_0 = (0, core_1.resolveAwsSdkSigV4Config)(config);
    const config_1 = (0, core_1.resolveAwsSdkSigV4AConfig)(config_0);
    return Object.assign(config_1, {
        authSchemePreference: (0, util_middleware_1.normalizeProvider)(config.authSchemePreference ?? []),
    });
};
exports.resolveHttpAuthSchemeConfig = resolveHttpAuthSchemeConfig;


/***/ }),

/***/ 75898:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.defaultEndpointResolver = void 0;
const util_endpoints_1 = __webpack_require__(94024);
const util_endpoints_2 = __webpack_require__(49622);
const ruleset_1 = __webpack_require__(86243);
const cache = new util_endpoints_2.EndpointCache({
    size: 50,
    params: [
        "Accelerate",
        "Bucket",
        "DisableAccessPoints",
        "DisableMultiRegionAccessPoints",
        "DisableS3ExpressSessionAuth",
        "Endpoint",
        "ForcePathStyle",
        "Region",
        "UseArnRegion",
        "UseDualStack",
        "UseFIPS",
        "UseGlobalEndpoint",
        "UseObjectLambdaEndpoint",
        "UseS3ExpressControlEndpoint",
    ],
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

/***/ 86243:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ruleSet = void 0;
const cs = "required", ct = "type", cu = "rules", cv = "conditions", cw = "fn", cx = "argv", cy = "ref", cz = "assign", cA = "url", cB = "properties", cC = "backend", cD = "authSchemes", cE = "disableDoubleEncoding", cF = "signingName", cG = "signingRegion", cH = "headers", cI = "signingRegionSet";
const a = 6, b = false, c = true, d = "isSet", e = "booleanEquals", f = "error", g = "aws.partition", h = "stringEquals", i = "getAttr", j = "name", k = "substring", l = "bucketSuffix", m = "parseURL", n = "endpoint", o = "tree", p = "aws.isVirtualHostableS3Bucket", q = "{url#scheme}://{Bucket}.{url#authority}{url#path}", r = "not", s = "accessPointSuffix", t = "{url#scheme}://{url#authority}{url#path}", u = "hardwareType", v = "regionPrefix", w = "bucketAliasSuffix", x = "outpostId", y = "isValidHostLabel", z = "sigv4a", A = "s3-outposts", B = "s3", C = "{url#scheme}://{url#authority}{url#normalizedPath}{Bucket}", D = "https://{Bucket}.s3-accelerate.{partitionResult#dnsSuffix}", E = "https://{Bucket}.s3.{partitionResult#dnsSuffix}", F = "aws.parseArn", G = "bucketArn", H = "arnType", I = "", J = "s3-object-lambda", K = "accesspoint", L = "accessPointName", M = "{url#scheme}://{accessPointName}-{bucketArn#accountId}.{url#authority}{url#path}", N = "mrapPartition", O = "outpostType", P = "arnPrefix", Q = "{url#scheme}://{url#authority}{url#normalizedPath}{uri_encoded_bucket}", R = "https://s3.{partitionResult#dnsSuffix}/{uri_encoded_bucket}", S = "https://s3.{partitionResult#dnsSuffix}", T = { [cs]: false, [ct]: "string" }, U = { [cs]: true, "default": false, [ct]: "boolean" }, V = { [cs]: false, [ct]: "boolean" }, W = { [cw]: e, [cx]: [{ [cy]: "Accelerate" }, true] }, X = { [cw]: e, [cx]: [{ [cy]: "UseFIPS" }, true] }, Y = { [cw]: e, [cx]: [{ [cy]: "UseDualStack" }, true] }, Z = { [cw]: d, [cx]: [{ [cy]: "Endpoint" }] }, aa = { [cw]: g, [cx]: [{ [cy]: "Region" }], [cz]: "partitionResult" }, ab = { [cw]: h, [cx]: [{ [cw]: i, [cx]: [{ [cy]: "partitionResult" }, j] }, "aws-cn"] }, ac = { [cw]: d, [cx]: [{ [cy]: "Bucket" }] }, ad = { [cy]: "Bucket" }, ae = { [cv]: [W], [f]: "S3Express does not support S3 Accelerate.", [ct]: f }, af = { [cv]: [Z, { [cw]: m, [cx]: [{ [cy]: "Endpoint" }], [cz]: "url" }], [cu]: [{ [cv]: [{ [cw]: d, [cx]: [{ [cy]: "DisableS3ExpressSessionAuth" }] }, { [cw]: e, [cx]: [{ [cy]: "DisableS3ExpressSessionAuth" }, true] }], [cu]: [{ [cv]: [{ [cw]: e, [cx]: [{ [cw]: i, [cx]: [{ [cy]: "url" }, "isIp"] }, true] }], [cu]: [{ [cv]: [{ [cw]: "uriEncode", [cx]: [ad], [cz]: "uri_encoded_bucket" }], [cu]: [{ [n]: { [cA]: "{url#scheme}://{url#authority}/{uri_encoded_bucket}{url#path}", [cB]: { [cC]: "S3Express", [cD]: [{ [cE]: true, [j]: "sigv4", [cF]: "s3express", [cG]: "{Region}" }] }, [cH]: {} }, [ct]: n }], [ct]: o }], [ct]: o }, { [cv]: [{ [cw]: p, [cx]: [ad, false] }], [cu]: [{ [n]: { [cA]: q, [cB]: { [cC]: "S3Express", [cD]: [{ [cE]: true, [j]: "sigv4", [cF]: "s3express", [cG]: "{Region}" }] }, [cH]: {} }, [ct]: n }], [ct]: o }, { [f]: "S3Express bucket name is not a valid virtual hostable name.", [ct]: f }], [ct]: o }, { [cv]: [{ [cw]: e, [cx]: [{ [cw]: i, [cx]: [{ [cy]: "url" }, "isIp"] }, true] }], [cu]: [{ [cv]: [{ [cw]: "uriEncode", [cx]: [ad], [cz]: "uri_encoded_bucket" }], [cu]: [{ [n]: { [cA]: "{url#scheme}://{url#authority}/{uri_encoded_bucket}{url#path}", [cB]: { [cC]: "S3Express", [cD]: [{ [cE]: true, [j]: "sigv4-s3express", [cF]: "s3express", [cG]: "{Region}" }] }, [cH]: {} }, [ct]: n }], [ct]: o }], [ct]: o }, { [cv]: [{ [cw]: p, [cx]: [ad, false] }], [cu]: [{ [n]: { [cA]: q, [cB]: { [cC]: "S3Express", [cD]: [{ [cE]: true, [j]: "sigv4-s3express", [cF]: "s3express", [cG]: "{Region}" }] }, [cH]: {} }, [ct]: n }], [ct]: o }, { [f]: "S3Express bucket name is not a valid virtual hostable name.", [ct]: f }], [ct]: o }, ag = { [cw]: m, [cx]: [{ [cy]: "Endpoint" }], [cz]: "url" }, ah = { [cw]: e, [cx]: [{ [cw]: i, [cx]: [{ [cy]: "url" }, "isIp"] }, true] }, ai = { [cy]: "url" }, aj = { [cw]: "uriEncode", [cx]: [ad], [cz]: "uri_encoded_bucket" }, ak = { [cC]: "S3Express", [cD]: [{ [cE]: true, [j]: "sigv4", [cF]: "s3express", [cG]: "{Region}" }] }, al = {}, am = { [cw]: p, [cx]: [ad, false] }, an = { [f]: "S3Express bucket name is not a valid virtual hostable name.", [ct]: f }, ao = { [cw]: d, [cx]: [{ [cy]: "UseS3ExpressControlEndpoint" }] }, ap = { [cw]: e, [cx]: [{ [cy]: "UseS3ExpressControlEndpoint" }, true] }, aq = { [cw]: r, [cx]: [Z] }, ar = { [cw]: e, [cx]: [{ [cy]: "UseDualStack" }, false] }, as = { [cw]: e, [cx]: [{ [cy]: "UseFIPS" }, false] }, at = { [f]: "Unrecognized S3Express bucket name format.", [ct]: f }, au = { [cw]: r, [cx]: [ac] }, av = { [cy]: u }, aw = { [cv]: [aq], [f]: "Expected a endpoint to be specified but no endpoint was found", [ct]: f }, ax = { [cD]: [{ [cE]: true, [j]: z, [cF]: A, [cI]: ["*"] }, { [cE]: true, [j]: "sigv4", [cF]: A, [cG]: "{Region}" }] }, ay = { [cw]: e, [cx]: [{ [cy]: "ForcePathStyle" }, false] }, az = { [cy]: "ForcePathStyle" }, aA = { [cw]: e, [cx]: [{ [cy]: "Accelerate" }, false] }, aB = { [cw]: h, [cx]: [{ [cy]: "Region" }, "aws-global"] }, aC = { [cD]: [{ [cE]: true, [j]: "sigv4", [cF]: B, [cG]: "us-east-1" }] }, aD = { [cw]: r, [cx]: [aB] }, aE = { [cw]: e, [cx]: [{ [cy]: "UseGlobalEndpoint" }, true] }, aF = { [cA]: "https://{Bucket}.s3-fips.dualstack.{Region}.{partitionResult#dnsSuffix}", [cB]: { [cD]: [{ [cE]: true, [j]: "sigv4", [cF]: B, [cG]: "{Region}" }] }, [cH]: {} }, aG = { [cD]: [{ [cE]: true, [j]: "sigv4", [cF]: B, [cG]: "{Region}" }] }, aH = { [cw]: e, [cx]: [{ [cy]: "UseGlobalEndpoint" }, false] }, aI = { [cA]: "https://{Bucket}.s3-fips.{Region}.{partitionResult#dnsSuffix}", [cB]: aG, [cH]: {} }, aJ = { [cA]: "https://{Bucket}.s3-accelerate.dualstack.{partitionResult#dnsSuffix}", [cB]: aG, [cH]: {} }, aK = { [cA]: "https://{Bucket}.s3.dualstack.{Region}.{partitionResult#dnsSuffix}", [cB]: aG, [cH]: {} }, aL = { [cw]: e, [cx]: [{ [cw]: i, [cx]: [ai, "isIp"] }, false] }, aM = { [cA]: C, [cB]: aG, [cH]: {} }, aN = { [cA]: q, [cB]: aG, [cH]: {} }, aO = { [n]: aN, [ct]: n }, aP = { [cA]: D, [cB]: aG, [cH]: {} }, aQ = { [cA]: "https://{Bucket}.s3.{Region}.{partitionResult#dnsSuffix}", [cB]: aG, [cH]: {} }, aR = { [f]: "Invalid region: region was not a valid DNS name.", [ct]: f }, aS = { [cy]: G }, aT = { [cy]: H }, aU = { [cw]: i, [cx]: [aS, "service"] }, aV = { [cy]: L }, aW = { [cv]: [Y], [f]: "S3 Object Lambda does not support Dual-stack", [ct]: f }, aX = { [cv]: [W], [f]: "S3 Object Lambda does not support S3 Accelerate", [ct]: f }, aY = { [cv]: [{ [cw]: d, [cx]: [{ [cy]: "DisableAccessPoints" }] }, { [cw]: e, [cx]: [{ [cy]: "DisableAccessPoints" }, true] }], [f]: "Access points are not supported for this operation", [ct]: f }, aZ = { [cv]: [{ [cw]: d, [cx]: [{ [cy]: "UseArnRegion" }] }, { [cw]: e, [cx]: [{ [cy]: "UseArnRegion" }, false] }, { [cw]: r, [cx]: [{ [cw]: h, [cx]: [{ [cw]: i, [cx]: [aS, "region"] }, "{Region}"] }] }], [f]: "Invalid configuration: region from ARN `{bucketArn#region}` does not match client region `{Region}` and UseArnRegion is `false`", [ct]: f }, ba = { [cw]: i, [cx]: [{ [cy]: "bucketPartition" }, j] }, bb = { [cw]: i, [cx]: [aS, "accountId"] }, bc = { [cD]: [{ [cE]: true, [j]: "sigv4", [cF]: J, [cG]: "{bucketArn#region}" }] }, bd = { [f]: "Invalid ARN: The access point name may only contain a-z, A-Z, 0-9 and `-`. Found: `{accessPointName}`", [ct]: f }, be = { [f]: "Invalid ARN: The account id may only contain a-z, A-Z, 0-9 and `-`. Found: `{bucketArn#accountId}`", [ct]: f }, bf = { [f]: "Invalid region in ARN: `{bucketArn#region}` (invalid DNS name)", [ct]: f }, bg = { [f]: "Client was configured for partition `{partitionResult#name}` but ARN (`{Bucket}`) has `{bucketPartition#name}`", [ct]: f }, bh = { [f]: "Invalid ARN: The ARN may only contain a single resource component after `accesspoint`.", [ct]: f }, bi = { [f]: "Invalid ARN: Expected a resource of the format `accesspoint:<accesspoint name>` but no name was provided", [ct]: f }, bj = { [cD]: [{ [cE]: true, [j]: "sigv4", [cF]: B, [cG]: "{bucketArn#region}" }] }, bk = { [cD]: [{ [cE]: true, [j]: z, [cF]: A, [cI]: ["*"] }, { [cE]: true, [j]: "sigv4", [cF]: A, [cG]: "{bucketArn#region}" }] }, bl = { [cw]: F, [cx]: [ad] }, bm = { [cA]: "https://s3-fips.dualstack.{Region}.{partitionResult#dnsSuffix}/{uri_encoded_bucket}", [cB]: aG, [cH]: {} }, bn = { [cA]: "https://s3-fips.{Region}.{partitionResult#dnsSuffix}/{uri_encoded_bucket}", [cB]: aG, [cH]: {} }, bo = { [cA]: "https://s3.dualstack.{Region}.{partitionResult#dnsSuffix}/{uri_encoded_bucket}", [cB]: aG, [cH]: {} }, bp = { [cA]: Q, [cB]: aG, [cH]: {} }, bq = { [cA]: "https://s3.{Region}.{partitionResult#dnsSuffix}/{uri_encoded_bucket}", [cB]: aG, [cH]: {} }, br = { [cy]: "UseObjectLambdaEndpoint" }, bs = { [cD]: [{ [cE]: true, [j]: "sigv4", [cF]: J, [cG]: "{Region}" }] }, bt = { [cA]: "https://s3-fips.dualstack.{Region}.{partitionResult#dnsSuffix}", [cB]: aG, [cH]: {} }, bu = { [cA]: "https://s3-fips.{Region}.{partitionResult#dnsSuffix}", [cB]: aG, [cH]: {} }, bv = { [cA]: "https://s3.dualstack.{Region}.{partitionResult#dnsSuffix}", [cB]: aG, [cH]: {} }, bw = { [cA]: t, [cB]: aG, [cH]: {} }, bx = { [cA]: "https://s3.{Region}.{partitionResult#dnsSuffix}", [cB]: aG, [cH]: {} }, by = [{ [cy]: "Region" }], bz = [{ [cy]: "Endpoint" }], bA = [ad], bB = [W], bC = [Z, ag], bD = [{ [cw]: d, [cx]: [{ [cy]: "DisableS3ExpressSessionAuth" }] }, { [cw]: e, [cx]: [{ [cy]: "DisableS3ExpressSessionAuth" }, true] }], bE = [aj], bF = [am], bG = [aa], bH = [X, Y], bI = [X, ar], bJ = [as, Y], bK = [as, ar], bL = [{ [cw]: k, [cx]: [ad, 6, 14, true], [cz]: "s3expressAvailabilityZoneId" }, { [cw]: k, [cx]: [ad, 14, 16, true], [cz]: "s3expressAvailabilityZoneDelim" }, { [cw]: h, [cx]: [{ [cy]: "s3expressAvailabilityZoneDelim" }, "--"] }], bM = [{ [cv]: [X, Y], [n]: { [cA]: "https://{Bucket}.s3express-fips-{s3expressAvailabilityZoneId}.dualstack.{Region}.{partitionResult#dnsSuffix}", [cB]: ak, [cH]: {} }, [ct]: n }, { [cv]: bI, [n]: { [cA]: "https://{Bucket}.s3express-fips-{s3expressAvailabilityZoneId}.{Region}.{partitionResult#dnsSuffix}", [cB]: ak, [cH]: {} }, [ct]: n }, { [cv]: bJ, [n]: { [cA]: "https://{Bucket}.s3express-{s3expressAvailabilityZoneId}.dualstack.{Region}.{partitionResult#dnsSuffix}", [cB]: ak, [cH]: {} }, [ct]: n }, { [cv]: bK, [n]: { [cA]: "https://{Bucket}.s3express-{s3expressAvailabilityZoneId}.{Region}.{partitionResult#dnsSuffix}", [cB]: ak, [cH]: {} }, [ct]: n }], bN = [{ [cw]: k, [cx]: [ad, 6, 15, true], [cz]: "s3expressAvailabilityZoneId" }, { [cw]: k, [cx]: [ad, 15, 17, true], [cz]: "s3expressAvailabilityZoneDelim" }, { [cw]: h, [cx]: [{ [cy]: "s3expressAvailabilityZoneDelim" }, "--"] }], bO = [{ [cw]: k, [cx]: [ad, 6, 19, true], [cz]: "s3expressAvailabilityZoneId" }, { [cw]: k, [cx]: [ad, 19, 21, true], [cz]: "s3expressAvailabilityZoneDelim" }, { [cw]: h, [cx]: [{ [cy]: "s3expressAvailabilityZoneDelim" }, "--"] }], bP = [{ [cw]: k, [cx]: [ad, 6, 20, true], [cz]: "s3expressAvailabilityZoneId" }, { [cw]: k, [cx]: [ad, 20, 22, true], [cz]: "s3expressAvailabilityZoneDelim" }, { [cw]: h, [cx]: [{ [cy]: "s3expressAvailabilityZoneDelim" }, "--"] }], bQ = [{ [cw]: k, [cx]: [ad, 6, 26, true], [cz]: "s3expressAvailabilityZoneId" }, { [cw]: k, [cx]: [ad, 26, 28, true], [cz]: "s3expressAvailabilityZoneDelim" }, { [cw]: h, [cx]: [{ [cy]: "s3expressAvailabilityZoneDelim" }, "--"] }], bR = [{ [cv]: [X, Y], [n]: { [cA]: "https://{Bucket}.s3express-fips-{s3expressAvailabilityZoneId}.dualstack.{Region}.{partitionResult#dnsSuffix}", [cB]: { [cC]: "S3Express", [cD]: [{ [cE]: true, [j]: "sigv4-s3express", [cF]: "s3express", [cG]: "{Region}" }] }, [cH]: {} }, [ct]: n }, { [cv]: bI, [n]: { [cA]: "https://{Bucket}.s3express-fips-{s3expressAvailabilityZoneId}.{Region}.{partitionResult#dnsSuffix}", [cB]: { [cC]: "S3Express", [cD]: [{ [cE]: true, [j]: "sigv4-s3express", [cF]: "s3express", [cG]: "{Region}" }] }, [cH]: {} }, [ct]: n }, { [cv]: bJ, [n]: { [cA]: "https://{Bucket}.s3express-{s3expressAvailabilityZoneId}.dualstack.{Region}.{partitionResult#dnsSuffix}", [cB]: { [cC]: "S3Express", [cD]: [{ [cE]: true, [j]: "sigv4-s3express", [cF]: "s3express", [cG]: "{Region}" }] }, [cH]: {} }, [ct]: n }, { [cv]: bK, [n]: { [cA]: "https://{Bucket}.s3express-{s3expressAvailabilityZoneId}.{Region}.{partitionResult#dnsSuffix}", [cB]: { [cC]: "S3Express", [cD]: [{ [cE]: true, [j]: "sigv4-s3express", [cF]: "s3express", [cG]: "{Region}" }] }, [cH]: {} }, [ct]: n }], bS = [ad, 0, 7, true], bT = [{ [cw]: k, [cx]: [ad, 7, 15, true], [cz]: "s3expressAvailabilityZoneId" }, { [cw]: k, [cx]: [ad, 15, 17, true], [cz]: "s3expressAvailabilityZoneDelim" }, { [cw]: h, [cx]: [{ [cy]: "s3expressAvailabilityZoneDelim" }, "--"] }], bU = [{ [cw]: k, [cx]: [ad, 7, 16, true], [cz]: "s3expressAvailabilityZoneId" }, { [cw]: k, [cx]: [ad, 16, 18, true], [cz]: "s3expressAvailabilityZoneDelim" }, { [cw]: h, [cx]: [{ [cy]: "s3expressAvailabilityZoneDelim" }, "--"] }], bV = [{ [cw]: k, [cx]: [ad, 7, 20, true], [cz]: "s3expressAvailabilityZoneId" }, { [cw]: k, [cx]: [ad, 20, 22, true], [cz]: "s3expressAvailabilityZoneDelim" }, { [cw]: h, [cx]: [{ [cy]: "s3expressAvailabilityZoneDelim" }, "--"] }], bW = [{ [cw]: k, [cx]: [ad, 7, 21, true], [cz]: "s3expressAvailabilityZoneId" }, { [cw]: k, [cx]: [ad, 21, 23, true], [cz]: "s3expressAvailabilityZoneDelim" }, { [cw]: h, [cx]: [{ [cy]: "s3expressAvailabilityZoneDelim" }, "--"] }], bX = [{ [cw]: k, [cx]: [ad, 7, 27, true], [cz]: "s3expressAvailabilityZoneId" }, { [cw]: k, [cx]: [ad, 27, 29, true], [cz]: "s3expressAvailabilityZoneDelim" }, { [cw]: h, [cx]: [{ [cy]: "s3expressAvailabilityZoneDelim" }, "--"] }], bY = [ac], bZ = [{ [cw]: y, [cx]: [{ [cy]: x }, false] }], ca = [{ [cw]: h, [cx]: [{ [cy]: v }, "beta"] }], cb = ["*"], cc = [{ [cw]: y, [cx]: [{ [cy]: "Region" }, false] }], cd = [{ [cw]: h, [cx]: [{ [cy]: "Region" }, "us-east-1"] }], ce = [{ [cw]: h, [cx]: [aT, K] }], cf = [{ [cw]: i, [cx]: [aS, "resourceId[1]"], [cz]: L }, { [cw]: r, [cx]: [{ [cw]: h, [cx]: [aV, I] }] }], cg = [aS, "resourceId[1]"], ch = [Y], ci = [{ [cw]: r, [cx]: [{ [cw]: h, [cx]: [{ [cw]: i, [cx]: [aS, "region"] }, I] }] }], cj = [{ [cw]: r, [cx]: [{ [cw]: d, [cx]: [{ [cw]: i, [cx]: [aS, "resourceId[2]"] }] }] }], ck = [aS, "resourceId[2]"], cl = [{ [cw]: g, [cx]: [{ [cw]: i, [cx]: [aS, "region"] }], [cz]: "bucketPartition" }], cm = [{ [cw]: h, [cx]: [ba, { [cw]: i, [cx]: [{ [cy]: "partitionResult" }, j] }] }], cn = [{ [cw]: y, [cx]: [{ [cw]: i, [cx]: [aS, "region"] }, true] }], co = [{ [cw]: y, [cx]: [bb, false] }], cp = [{ [cw]: y, [cx]: [aV, false] }], cq = [X], cr = [{ [cw]: y, [cx]: [{ [cy]: "Region" }, true] }];
const _data = { version: "1.0", parameters: { Bucket: T, Region: T, UseFIPS: U, UseDualStack: U, Endpoint: T, ForcePathStyle: U, Accelerate: U, UseGlobalEndpoint: U, UseObjectLambdaEndpoint: V, Key: T, Prefix: T, CopySource: T, DisableAccessPoints: V, DisableMultiRegionAccessPoints: U, UseArnRegion: V, UseS3ExpressControlEndpoint: V, DisableS3ExpressSessionAuth: V }, [cu]: [{ [cv]: [{ [cw]: d, [cx]: by }], [cu]: [{ [cv]: [W, X], error: "Accelerate cannot be used with FIPS", [ct]: f }, { [cv]: [Y, Z], error: "Cannot set dual-stack in combination with a custom endpoint.", [ct]: f }, { [cv]: [Z, X], error: "A custom endpoint cannot be combined with FIPS", [ct]: f }, { [cv]: [Z, W], error: "A custom endpoint cannot be combined with S3 Accelerate", [ct]: f }, { [cv]: [X, aa, ab], error: "Partition does not support FIPS", [ct]: f }, { [cv]: [ac, { [cw]: k, [cx]: [ad, 0, a, c], [cz]: l }, { [cw]: h, [cx]: [{ [cy]: l }, "--x-s3"] }], [cu]: [ae, af, { [cv]: [ao, ap], [cu]: [{ [cv]: bG, [cu]: [{ [cv]: [aj, aq], [cu]: [{ [cv]: bH, endpoint: { [cA]: "https://s3express-control-fips.dualstack.{Region}.{partitionResult#dnsSuffix}/{uri_encoded_bucket}", [cB]: ak, [cH]: al }, [ct]: n }, { [cv]: bI, endpoint: { [cA]: "https://s3express-control-fips.{Region}.{partitionResult#dnsSuffix}/{uri_encoded_bucket}", [cB]: ak, [cH]: al }, [ct]: n }, { [cv]: bJ, endpoint: { [cA]: "https://s3express-control.dualstack.{Region}.{partitionResult#dnsSuffix}/{uri_encoded_bucket}", [cB]: ak, [cH]: al }, [ct]: n }, { [cv]: bK, endpoint: { [cA]: "https://s3express-control.{Region}.{partitionResult#dnsSuffix}/{uri_encoded_bucket}", [cB]: ak, [cH]: al }, [ct]: n }], [ct]: o }], [ct]: o }], [ct]: o }, { [cv]: bF, [cu]: [{ [cv]: bG, [cu]: [{ [cv]: bD, [cu]: [{ [cv]: bL, [cu]: bM, [ct]: o }, { [cv]: bN, [cu]: bM, [ct]: o }, { [cv]: bO, [cu]: bM, [ct]: o }, { [cv]: bP, [cu]: bM, [ct]: o }, { [cv]: bQ, [cu]: bM, [ct]: o }, at], [ct]: o }, { [cv]: bL, [cu]: bR, [ct]: o }, { [cv]: bN, [cu]: bR, [ct]: o }, { [cv]: bO, [cu]: bR, [ct]: o }, { [cv]: bP, [cu]: bR, [ct]: o }, { [cv]: bQ, [cu]: bR, [ct]: o }, at], [ct]: o }], [ct]: o }, an], [ct]: o }, { [cv]: [ac, { [cw]: k, [cx]: bS, [cz]: s }, { [cw]: h, [cx]: [{ [cy]: s }, "--xa-s3"] }], [cu]: [ae, af, { [cv]: bF, [cu]: [{ [cv]: bG, [cu]: [{ [cv]: bD, [cu]: [{ [cv]: bT, [cu]: bM, [ct]: o }, { [cv]: bU, [cu]: bM, [ct]: o }, { [cv]: bV, [cu]: bM, [ct]: o }, { [cv]: bW, [cu]: bM, [ct]: o }, { [cv]: bX, [cu]: bM, [ct]: o }, at], [ct]: o }, { [cv]: bT, [cu]: bR, [ct]: o }, { [cv]: bU, [cu]: bR, [ct]: o }, { [cv]: bV, [cu]: bR, [ct]: o }, { [cv]: bW, [cu]: bR, [ct]: o }, { [cv]: bX, [cu]: bR, [ct]: o }, at], [ct]: o }], [ct]: o }, an], [ct]: o }, { [cv]: [au, ao, ap], [cu]: [{ [cv]: bG, [cu]: [{ [cv]: bC, endpoint: { [cA]: t, [cB]: ak, [cH]: al }, [ct]: n }, { [cv]: bH, endpoint: { [cA]: "https://s3express-control-fips.dualstack.{Region}.{partitionResult#dnsSuffix}", [cB]: ak, [cH]: al }, [ct]: n }, { [cv]: bI, endpoint: { [cA]: "https://s3express-control-fips.{Region}.{partitionResult#dnsSuffix}", [cB]: ak, [cH]: al }, [ct]: n }, { [cv]: bJ, endpoint: { [cA]: "https://s3express-control.dualstack.{Region}.{partitionResult#dnsSuffix}", [cB]: ak, [cH]: al }, [ct]: n }, { [cv]: bK, endpoint: { [cA]: "https://s3express-control.{Region}.{partitionResult#dnsSuffix}", [cB]: ak, [cH]: al }, [ct]: n }], [ct]: o }], [ct]: o }, { [cv]: [ac, { [cw]: k, [cx]: [ad, 49, 50, c], [cz]: u }, { [cw]: k, [cx]: [ad, 8, 12, c], [cz]: v }, { [cw]: k, [cx]: bS, [cz]: w }, { [cw]: k, [cx]: [ad, 32, 49, c], [cz]: x }, { [cw]: g, [cx]: by, [cz]: "regionPartition" }, { [cw]: h, [cx]: [{ [cy]: w }, "--op-s3"] }], [cu]: [{ [cv]: bZ, [cu]: [{ [cv]: bF, [cu]: [{ [cv]: [{ [cw]: h, [cx]: [av, "e"] }], [cu]: [{ [cv]: ca, [cu]: [aw, { [cv]: bC, endpoint: { [cA]: "https://{Bucket}.ec2.{url#authority}", [cB]: ax, [cH]: al }, [ct]: n }], [ct]: o }, { endpoint: { [cA]: "https://{Bucket}.ec2.s3-outposts.{Region}.{regionPartition#dnsSuffix}", [cB]: ax, [cH]: al }, [ct]: n }], [ct]: o }, { [cv]: [{ [cw]: h, [cx]: [av, "o"] }], [cu]: [{ [cv]: ca, [cu]: [aw, { [cv]: bC, endpoint: { [cA]: "https://{Bucket}.op-{outpostId}.{url#authority}", [cB]: ax, [cH]: al }, [ct]: n }], [ct]: o }, { endpoint: { [cA]: "https://{Bucket}.op-{outpostId}.s3-outposts.{Region}.{regionPartition#dnsSuffix}", [cB]: ax, [cH]: al }, [ct]: n }], [ct]: o }, { error: "Unrecognized hardware type: \"Expected hardware type o or e but got {hardwareType}\"", [ct]: f }], [ct]: o }, { error: "Invalid Outposts Bucket alias - it must be a valid bucket name.", [ct]: f }], [ct]: o }, { error: "Invalid ARN: The outpost Id must only contain a-z, A-Z, 0-9 and `-`.", [ct]: f }], [ct]: o }, { [cv]: bY, [cu]: [{ [cv]: [Z, { [cw]: r, [cx]: [{ [cw]: d, [cx]: [{ [cw]: m, [cx]: bz }] }] }], error: "Custom endpoint `{Endpoint}` was not a valid URI", [ct]: f }, { [cv]: [ay, am], [cu]: [{ [cv]: bG, [cu]: [{ [cv]: cc, [cu]: [{ [cv]: [W, ab], error: "S3 Accelerate cannot be used in this region", [ct]: f }, { [cv]: [Y, X, aA, aq, aB], endpoint: { [cA]: "https://{Bucket}.s3-fips.dualstack.us-east-1.{partitionResult#dnsSuffix}", [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [Y, X, aA, aq, aD, aE], [cu]: [{ endpoint: aF, [ct]: n }], [ct]: o }, { [cv]: [Y, X, aA, aq, aD, aH], endpoint: aF, [ct]: n }, { [cv]: [ar, X, aA, aq, aB], endpoint: { [cA]: "https://{Bucket}.s3-fips.us-east-1.{partitionResult#dnsSuffix}", [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [ar, X, aA, aq, aD, aE], [cu]: [{ endpoint: aI, [ct]: n }], [ct]: o }, { [cv]: [ar, X, aA, aq, aD, aH], endpoint: aI, [ct]: n }, { [cv]: [Y, as, W, aq, aB], endpoint: { [cA]: "https://{Bucket}.s3-accelerate.dualstack.us-east-1.{partitionResult#dnsSuffix}", [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [Y, as, W, aq, aD, aE], [cu]: [{ endpoint: aJ, [ct]: n }], [ct]: o }, { [cv]: [Y, as, W, aq, aD, aH], endpoint: aJ, [ct]: n }, { [cv]: [Y, as, aA, aq, aB], endpoint: { [cA]: "https://{Bucket}.s3.dualstack.us-east-1.{partitionResult#dnsSuffix}", [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [Y, as, aA, aq, aD, aE], [cu]: [{ endpoint: aK, [ct]: n }], [ct]: o }, { [cv]: [Y, as, aA, aq, aD, aH], endpoint: aK, [ct]: n }, { [cv]: [ar, as, aA, Z, ag, ah, aB], endpoint: { [cA]: C, [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [ar, as, aA, Z, ag, aL, aB], endpoint: { [cA]: q, [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [ar, as, aA, Z, ag, ah, aD, aE], [cu]: [{ [cv]: cd, endpoint: aM, [ct]: n }, { endpoint: aM, [ct]: n }], [ct]: o }, { [cv]: [ar, as, aA, Z, ag, aL, aD, aE], [cu]: [{ [cv]: cd, endpoint: aN, [ct]: n }, aO], [ct]: o }, { [cv]: [ar, as, aA, Z, ag, ah, aD, aH], endpoint: aM, [ct]: n }, { [cv]: [ar, as, aA, Z, ag, aL, aD, aH], endpoint: aN, [ct]: n }, { [cv]: [ar, as, W, aq, aB], endpoint: { [cA]: D, [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [ar, as, W, aq, aD, aE], [cu]: [{ [cv]: cd, endpoint: aP, [ct]: n }, { endpoint: aP, [ct]: n }], [ct]: o }, { [cv]: [ar, as, W, aq, aD, aH], endpoint: aP, [ct]: n }, { [cv]: [ar, as, aA, aq, aB], endpoint: { [cA]: E, [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [ar, as, aA, aq, aD, aE], [cu]: [{ [cv]: cd, endpoint: { [cA]: E, [cB]: aG, [cH]: al }, [ct]: n }, { endpoint: aQ, [ct]: n }], [ct]: o }, { [cv]: [ar, as, aA, aq, aD, aH], endpoint: aQ, [ct]: n }], [ct]: o }, aR], [ct]: o }], [ct]: o }, { [cv]: [Z, ag, { [cw]: h, [cx]: [{ [cw]: i, [cx]: [ai, "scheme"] }, "http"] }, { [cw]: p, [cx]: [ad, c] }, ay, as, ar, aA], [cu]: [{ [cv]: bG, [cu]: [{ [cv]: cc, [cu]: [aO], [ct]: o }, aR], [ct]: o }], [ct]: o }, { [cv]: [ay, { [cw]: F, [cx]: bA, [cz]: G }], [cu]: [{ [cv]: [{ [cw]: i, [cx]: [aS, "resourceId[0]"], [cz]: H }, { [cw]: r, [cx]: [{ [cw]: h, [cx]: [aT, I] }] }], [cu]: [{ [cv]: [{ [cw]: h, [cx]: [aU, J] }], [cu]: [{ [cv]: ce, [cu]: [{ [cv]: cf, [cu]: [aW, aX, { [cv]: ci, [cu]: [aY, { [cv]: cj, [cu]: [aZ, { [cv]: cl, [cu]: [{ [cv]: bG, [cu]: [{ [cv]: cm, [cu]: [{ [cv]: cn, [cu]: [{ [cv]: [{ [cw]: h, [cx]: [bb, I] }], error: "Invalid ARN: Missing account id", [ct]: f }, { [cv]: co, [cu]: [{ [cv]: cp, [cu]: [{ [cv]: bC, endpoint: { [cA]: M, [cB]: bc, [cH]: al }, [ct]: n }, { [cv]: cq, endpoint: { [cA]: "https://{accessPointName}-{bucketArn#accountId}.s3-object-lambda-fips.{bucketArn#region}.{bucketPartition#dnsSuffix}", [cB]: bc, [cH]: al }, [ct]: n }, { endpoint: { [cA]: "https://{accessPointName}-{bucketArn#accountId}.s3-object-lambda.{bucketArn#region}.{bucketPartition#dnsSuffix}", [cB]: bc, [cH]: al }, [ct]: n }], [ct]: o }, bd], [ct]: o }, be], [ct]: o }, bf], [ct]: o }, bg], [ct]: o }], [ct]: o }], [ct]: o }, bh], [ct]: o }, { error: "Invalid ARN: bucket ARN is missing a region", [ct]: f }], [ct]: o }, bi], [ct]: o }, { error: "Invalid ARN: Object Lambda ARNs only support `accesspoint` arn types, but found: `{arnType}`", [ct]: f }], [ct]: o }, { [cv]: ce, [cu]: [{ [cv]: cf, [cu]: [{ [cv]: ci, [cu]: [{ [cv]: ce, [cu]: [{ [cv]: ci, [cu]: [aY, { [cv]: cj, [cu]: [aZ, { [cv]: cl, [cu]: [{ [cv]: bG, [cu]: [{ [cv]: [{ [cw]: h, [cx]: [ba, "{partitionResult#name}"] }], [cu]: [{ [cv]: cn, [cu]: [{ [cv]: [{ [cw]: h, [cx]: [aU, B] }], [cu]: [{ [cv]: co, [cu]: [{ [cv]: cp, [cu]: [{ [cv]: bB, error: "Access Points do not support S3 Accelerate", [ct]: f }, { [cv]: bH, endpoint: { [cA]: "https://{accessPointName}-{bucketArn#accountId}.s3-accesspoint-fips.dualstack.{bucketArn#region}.{bucketPartition#dnsSuffix}", [cB]: bj, [cH]: al }, [ct]: n }, { [cv]: bI, endpoint: { [cA]: "https://{accessPointName}-{bucketArn#accountId}.s3-accesspoint-fips.{bucketArn#region}.{bucketPartition#dnsSuffix}", [cB]: bj, [cH]: al }, [ct]: n }, { [cv]: bJ, endpoint: { [cA]: "https://{accessPointName}-{bucketArn#accountId}.s3-accesspoint.dualstack.{bucketArn#region}.{bucketPartition#dnsSuffix}", [cB]: bj, [cH]: al }, [ct]: n }, { [cv]: [as, ar, Z, ag], endpoint: { [cA]: M, [cB]: bj, [cH]: al }, [ct]: n }, { [cv]: bK, endpoint: { [cA]: "https://{accessPointName}-{bucketArn#accountId}.s3-accesspoint.{bucketArn#region}.{bucketPartition#dnsSuffix}", [cB]: bj, [cH]: al }, [ct]: n }], [ct]: o }, bd], [ct]: o }, be], [ct]: o }, { error: "Invalid ARN: The ARN was not for the S3 service, found: {bucketArn#service}", [ct]: f }], [ct]: o }, bf], [ct]: o }, bg], [ct]: o }], [ct]: o }], [ct]: o }, bh], [ct]: o }], [ct]: o }], [ct]: o }, { [cv]: [{ [cw]: y, [cx]: [aV, c] }], [cu]: [{ [cv]: ch, error: "S3 MRAP does not support dual-stack", [ct]: f }, { [cv]: cq, error: "S3 MRAP does not support FIPS", [ct]: f }, { [cv]: bB, error: "S3 MRAP does not support S3 Accelerate", [ct]: f }, { [cv]: [{ [cw]: e, [cx]: [{ [cy]: "DisableMultiRegionAccessPoints" }, c] }], error: "Invalid configuration: Multi-Region Access Point ARNs are disabled.", [ct]: f }, { [cv]: [{ [cw]: g, [cx]: by, [cz]: N }], [cu]: [{ [cv]: [{ [cw]: h, [cx]: [{ [cw]: i, [cx]: [{ [cy]: N }, j] }, { [cw]: i, [cx]: [aS, "partition"] }] }], [cu]: [{ endpoint: { [cA]: "https://{accessPointName}.accesspoint.s3-global.{mrapPartition#dnsSuffix}", [cB]: { [cD]: [{ [cE]: c, name: z, [cF]: B, [cI]: cb }] }, [cH]: al }, [ct]: n }], [ct]: o }, { error: "Client was configured for partition `{mrapPartition#name}` but bucket referred to partition `{bucketArn#partition}`", [ct]: f }], [ct]: o }], [ct]: o }, { error: "Invalid Access Point Name", [ct]: f }], [ct]: o }, bi], [ct]: o }, { [cv]: [{ [cw]: h, [cx]: [aU, A] }], [cu]: [{ [cv]: ch, error: "S3 Outposts does not support Dual-stack", [ct]: f }, { [cv]: cq, error: "S3 Outposts does not support FIPS", [ct]: f }, { [cv]: bB, error: "S3 Outposts does not support S3 Accelerate", [ct]: f }, { [cv]: [{ [cw]: d, [cx]: [{ [cw]: i, [cx]: [aS, "resourceId[4]"] }] }], error: "Invalid Arn: Outpost Access Point ARN contains sub resources", [ct]: f }, { [cv]: [{ [cw]: i, [cx]: cg, [cz]: x }], [cu]: [{ [cv]: bZ, [cu]: [aZ, { [cv]: cl, [cu]: [{ [cv]: bG, [cu]: [{ [cv]: cm, [cu]: [{ [cv]: cn, [cu]: [{ [cv]: co, [cu]: [{ [cv]: [{ [cw]: i, [cx]: ck, [cz]: O }], [cu]: [{ [cv]: [{ [cw]: i, [cx]: [aS, "resourceId[3]"], [cz]: L }], [cu]: [{ [cv]: [{ [cw]: h, [cx]: [{ [cy]: O }, K] }], [cu]: [{ [cv]: bC, endpoint: { [cA]: "https://{accessPointName}-{bucketArn#accountId}.{outpostId}.{url#authority}", [cB]: bk, [cH]: al }, [ct]: n }, { endpoint: { [cA]: "https://{accessPointName}-{bucketArn#accountId}.{outpostId}.s3-outposts.{bucketArn#region}.{bucketPartition#dnsSuffix}", [cB]: bk, [cH]: al }, [ct]: n }], [ct]: o }, { error: "Expected an outpost type `accesspoint`, found {outpostType}", [ct]: f }], [ct]: o }, { error: "Invalid ARN: expected an access point name", [ct]: f }], [ct]: o }, { error: "Invalid ARN: Expected a 4-component resource", [ct]: f }], [ct]: o }, be], [ct]: o }, bf], [ct]: o }, bg], [ct]: o }], [ct]: o }], [ct]: o }, { error: "Invalid ARN: The outpost Id may only contain a-z, A-Z, 0-9 and `-`. Found: `{outpostId}`", [ct]: f }], [ct]: o }, { error: "Invalid ARN: The Outpost Id was not set", [ct]: f }], [ct]: o }, { error: "Invalid ARN: Unrecognized format: {Bucket} (type: {arnType})", [ct]: f }], [ct]: o }, { error: "Invalid ARN: No ARN type specified", [ct]: f }], [ct]: o }, { [cv]: [{ [cw]: k, [cx]: [ad, 0, 4, b], [cz]: P }, { [cw]: h, [cx]: [{ [cy]: P }, "arn:"] }, { [cw]: r, [cx]: [{ [cw]: d, [cx]: [bl] }] }], error: "Invalid ARN: `{Bucket}` was not a valid ARN", [ct]: f }, { [cv]: [{ [cw]: e, [cx]: [az, c] }, bl], error: "Path-style addressing cannot be used with ARN buckets", [ct]: f }, { [cv]: bE, [cu]: [{ [cv]: bG, [cu]: [{ [cv]: [aA], [cu]: [{ [cv]: [Y, aq, X, aB], endpoint: { [cA]: "https://s3-fips.dualstack.us-east-1.{partitionResult#dnsSuffix}/{uri_encoded_bucket}", [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [Y, aq, X, aD, aE], [cu]: [{ endpoint: bm, [ct]: n }], [ct]: o }, { [cv]: [Y, aq, X, aD, aH], endpoint: bm, [ct]: n }, { [cv]: [ar, aq, X, aB], endpoint: { [cA]: "https://s3-fips.us-east-1.{partitionResult#dnsSuffix}/{uri_encoded_bucket}", [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [ar, aq, X, aD, aE], [cu]: [{ endpoint: bn, [ct]: n }], [ct]: o }, { [cv]: [ar, aq, X, aD, aH], endpoint: bn, [ct]: n }, { [cv]: [Y, aq, as, aB], endpoint: { [cA]: "https://s3.dualstack.us-east-1.{partitionResult#dnsSuffix}/{uri_encoded_bucket}", [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [Y, aq, as, aD, aE], [cu]: [{ endpoint: bo, [ct]: n }], [ct]: o }, { [cv]: [Y, aq, as, aD, aH], endpoint: bo, [ct]: n }, { [cv]: [ar, Z, ag, as, aB], endpoint: { [cA]: Q, [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [ar, Z, ag, as, aD, aE], [cu]: [{ [cv]: cd, endpoint: bp, [ct]: n }, { endpoint: bp, [ct]: n }], [ct]: o }, { [cv]: [ar, Z, ag, as, aD, aH], endpoint: bp, [ct]: n }, { [cv]: [ar, aq, as, aB], endpoint: { [cA]: R, [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [ar, aq, as, aD, aE], [cu]: [{ [cv]: cd, endpoint: { [cA]: R, [cB]: aG, [cH]: al }, [ct]: n }, { endpoint: bq, [ct]: n }], [ct]: o }, { [cv]: [ar, aq, as, aD, aH], endpoint: bq, [ct]: n }], [ct]: o }, { error: "Path-style addressing cannot be used with S3 Accelerate", [ct]: f }], [ct]: o }], [ct]: o }], [ct]: o }, { [cv]: [{ [cw]: d, [cx]: [br] }, { [cw]: e, [cx]: [br, c] }], [cu]: [{ [cv]: bG, [cu]: [{ [cv]: cr, [cu]: [aW, aX, { [cv]: bC, endpoint: { [cA]: t, [cB]: bs, [cH]: al }, [ct]: n }, { [cv]: cq, endpoint: { [cA]: "https://s3-object-lambda-fips.{Region}.{partitionResult#dnsSuffix}", [cB]: bs, [cH]: al }, [ct]: n }, { endpoint: { [cA]: "https://s3-object-lambda.{Region}.{partitionResult#dnsSuffix}", [cB]: bs, [cH]: al }, [ct]: n }], [ct]: o }, aR], [ct]: o }], [ct]: o }, { [cv]: [au], [cu]: [{ [cv]: bG, [cu]: [{ [cv]: cr, [cu]: [{ [cv]: [X, Y, aq, aB], endpoint: { [cA]: "https://s3-fips.dualstack.us-east-1.{partitionResult#dnsSuffix}", [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [X, Y, aq, aD, aE], [cu]: [{ endpoint: bt, [ct]: n }], [ct]: o }, { [cv]: [X, Y, aq, aD, aH], endpoint: bt, [ct]: n }, { [cv]: [X, ar, aq, aB], endpoint: { [cA]: "https://s3-fips.us-east-1.{partitionResult#dnsSuffix}", [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [X, ar, aq, aD, aE], [cu]: [{ endpoint: bu, [ct]: n }], [ct]: o }, { [cv]: [X, ar, aq, aD, aH], endpoint: bu, [ct]: n }, { [cv]: [as, Y, aq, aB], endpoint: { [cA]: "https://s3.dualstack.us-east-1.{partitionResult#dnsSuffix}", [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [as, Y, aq, aD, aE], [cu]: [{ endpoint: bv, [ct]: n }], [ct]: o }, { [cv]: [as, Y, aq, aD, aH], endpoint: bv, [ct]: n }, { [cv]: [as, ar, Z, ag, aB], endpoint: { [cA]: t, [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [as, ar, Z, ag, aD, aE], [cu]: [{ [cv]: cd, endpoint: bw, [ct]: n }, { endpoint: bw, [ct]: n }], [ct]: o }, { [cv]: [as, ar, Z, ag, aD, aH], endpoint: bw, [ct]: n }, { [cv]: [as, ar, aq, aB], endpoint: { [cA]: S, [cB]: aC, [cH]: al }, [ct]: n }, { [cv]: [as, ar, aq, aD, aE], [cu]: [{ [cv]: cd, endpoint: { [cA]: S, [cB]: aG, [cH]: al }, [ct]: n }, { endpoint: bx, [ct]: n }], [ct]: o }, { [cv]: [as, ar, aq, aD, aH], endpoint: bx, [ct]: n }], [ct]: o }, aR], [ct]: o }], [ct]: o }], [ct]: o }, { error: "A region must be set when sending requests to S3.", [ct]: f }] };
exports.ruleSet = _data;


/***/ }),

/***/ 28299:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var middlewareExpectContinue = __webpack_require__(10517);
var middlewareFlexibleChecksums = __webpack_require__(90008);
var middlewareHostHeader = __webpack_require__(54746);
var middlewareLogger = __webpack_require__(10438);
var middlewareRecursionDetection = __webpack_require__(52588);
var middlewareSdkS3 = __webpack_require__(68937);
var middlewareUserAgent = __webpack_require__(3979);
var configResolver = __webpack_require__(93768);
var core = __webpack_require__(75086);
var schema = __webpack_require__(15982);
var eventstreamSerdeConfigResolver = __webpack_require__(23947);
var middlewareContentLength = __webpack_require__(82352);
var middlewareEndpoint = __webpack_require__(10775);
var middlewareRetry = __webpack_require__(46318);
var smithyClient = __webpack_require__(58015);
var httpAuthSchemeProvider = __webpack_require__(10340);
var schemas_0 = __webpack_require__(2335);
var runtimeConfig = __webpack_require__(23581);
var regionConfigResolver = __webpack_require__(52627);
var protocolHttp = __webpack_require__(29752);
var middlewareSsec = __webpack_require__(6060);
var middlewareLocationConstraint = __webpack_require__(25837);
var utilWaiter = __webpack_require__(89766);
var errors = __webpack_require__(65003);
var S3ServiceException = __webpack_require__(64534);

const resolveClientEndpointParameters = (options) => {
    return Object.assign(options, {
        useFipsEndpoint: options.useFipsEndpoint ?? false,
        useDualstackEndpoint: options.useDualstackEndpoint ?? false,
        forcePathStyle: options.forcePathStyle ?? false,
        useAccelerateEndpoint: options.useAccelerateEndpoint ?? false,
        useGlobalEndpoint: options.useGlobalEndpoint ?? false,
        disableMultiregionAccessPoints: options.disableMultiregionAccessPoints ?? false,
        defaultSigningName: "s3",
        clientContextParams: options.clientContextParams ?? {},
    });
};
const commonParams = {
    ForcePathStyle: { type: "clientContextParams", name: "forcePathStyle" },
    UseArnRegion: { type: "clientContextParams", name: "useArnRegion" },
    DisableMultiRegionAccessPoints: { type: "clientContextParams", name: "disableMultiregionAccessPoints" },
    Accelerate: { type: "clientContextParams", name: "useAccelerateEndpoint" },
    DisableS3ExpressSessionAuth: { type: "clientContextParams", name: "disableS3ExpressSessionAuth" },
    UseGlobalEndpoint: { type: "builtInParams", name: "useGlobalEndpoint" },
    UseFIPS: { type: "builtInParams", name: "useFipsEndpoint" },
    Endpoint: { type: "builtInParams", name: "endpoint" },
    Region: { type: "builtInParams", name: "region" },
    UseDualStack: { type: "builtInParams", name: "useDualstackEndpoint" },
};

class CreateSessionCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    DisableS3ExpressSessionAuth: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "CreateSession", {})
    .n("S3Client", "CreateSessionCommand")
    .sc(schemas_0.CreateSession$)
    .build() {
}

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

class S3Client extends smithyClient.Client {
    config;
    constructor(...[configuration]) {
        const _config_0 = runtimeConfig.getRuntimeConfig(configuration || {});
        super(_config_0);
        this.initConfig = _config_0;
        const _config_1 = resolveClientEndpointParameters(_config_0);
        const _config_2 = middlewareUserAgent.resolveUserAgentConfig(_config_1);
        const _config_3 = middlewareFlexibleChecksums.resolveFlexibleChecksumsConfig(_config_2);
        const _config_4 = middlewareRetry.resolveRetryConfig(_config_3);
        const _config_5 = configResolver.resolveRegionConfig(_config_4);
        const _config_6 = middlewareHostHeader.resolveHostHeaderConfig(_config_5);
        const _config_7 = middlewareEndpoint.resolveEndpointConfig(_config_6);
        const _config_8 = eventstreamSerdeConfigResolver.resolveEventStreamSerdeConfig(_config_7);
        const _config_9 = httpAuthSchemeProvider.resolveHttpAuthSchemeConfig(_config_8);
        const _config_10 = middlewareSdkS3.resolveS3Config(_config_9, { session: [() => this, CreateSessionCommand] });
        const _config_11 = resolveRuntimeExtensions(_config_10, configuration?.extensions || []);
        this.config = _config_11;
        this.middlewareStack.use(schema.getSchemaSerdePlugin(this.config));
        this.middlewareStack.use(middlewareUserAgent.getUserAgentPlugin(this.config));
        this.middlewareStack.use(middlewareRetry.getRetryPlugin(this.config));
        this.middlewareStack.use(middlewareContentLength.getContentLengthPlugin(this.config));
        this.middlewareStack.use(middlewareHostHeader.getHostHeaderPlugin(this.config));
        this.middlewareStack.use(middlewareLogger.getLoggerPlugin(this.config));
        this.middlewareStack.use(middlewareRecursionDetection.getRecursionDetectionPlugin(this.config));
        this.middlewareStack.use(core.getHttpAuthSchemeEndpointRuleSetPlugin(this.config, {
            httpAuthSchemeParametersProvider: httpAuthSchemeProvider.defaultS3HttpAuthSchemeParametersProvider,
            identityProviderConfigProvider: async (config) => new core.DefaultIdentityProviderConfig({
                "aws.auth#sigv4": config.credentials,
                "aws.auth#sigv4a": config.credentials,
            }),
        }));
        this.middlewareStack.use(core.getHttpSigningPlugin(this.config));
        this.middlewareStack.use(middlewareSdkS3.getValidateBucketNamePlugin(this.config));
        this.middlewareStack.use(middlewareExpectContinue.getAddExpectContinuePlugin(this.config));
        this.middlewareStack.use(middlewareSdkS3.getRegionRedirectMiddlewarePlugin(this.config));
        this.middlewareStack.use(middlewareSdkS3.getS3ExpressPlugin(this.config));
        this.middlewareStack.use(middlewareSdkS3.getS3ExpressHttpSigningPlugin(this.config));
    }
    destroy() {
        super.destroy();
    }
}

class AbortMultipartUploadCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Key: { type: "contextParams", name: "Key" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "AbortMultipartUpload", {})
    .n("S3Client", "AbortMultipartUploadCommand")
    .sc(schemas_0.AbortMultipartUpload$)
    .build() {
}

class CompleteMultipartUploadCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Key: { type: "contextParams", name: "Key" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
        middlewareSsec.getSsecPlugin(config),
    ];
})
    .s("AmazonS3", "CompleteMultipartUpload", {})
    .n("S3Client", "CompleteMultipartUploadCommand")
    .sc(schemas_0.CompleteMultipartUpload$)
    .build() {
}

class CopyObjectCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    DisableS3ExpressSessionAuth: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
    Key: { type: "contextParams", name: "Key" },
    CopySource: { type: "contextParams", name: "CopySource" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
        middlewareSsec.getSsecPlugin(config),
    ];
})
    .s("AmazonS3", "CopyObject", {})
    .n("S3Client", "CopyObjectCommand")
    .sc(schemas_0.CopyObject$)
    .build() {
}

class CreateBucketCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    DisableAccessPoints: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
        middlewareLocationConstraint.getLocationConstraintPlugin(config),
    ];
})
    .s("AmazonS3", "CreateBucket", {})
    .n("S3Client", "CreateBucketCommand")
    .sc(schemas_0.CreateBucket$)
    .build() {
}

class CreateBucketMetadataConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "CreateBucketMetadataConfiguration", {})
    .n("S3Client", "CreateBucketMetadataConfigurationCommand")
    .sc(schemas_0.CreateBucketMetadataConfiguration$)
    .build() {
}

class CreateBucketMetadataTableConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "CreateBucketMetadataTableConfiguration", {})
    .n("S3Client", "CreateBucketMetadataTableConfigurationCommand")
    .sc(schemas_0.CreateBucketMetadataTableConfiguration$)
    .build() {
}

class CreateMultipartUploadCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Key: { type: "contextParams", name: "Key" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
        middlewareSsec.getSsecPlugin(config),
    ];
})
    .s("AmazonS3", "CreateMultipartUpload", {})
    .n("S3Client", "CreateMultipartUploadCommand")
    .sc(schemas_0.CreateMultipartUpload$)
    .build() {
}

class DeleteBucketAnalyticsConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketAnalyticsConfiguration", {})
    .n("S3Client", "DeleteBucketAnalyticsConfigurationCommand")
    .sc(schemas_0.DeleteBucketAnalyticsConfiguration$)
    .build() {
}

class DeleteBucketCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucket", {})
    .n("S3Client", "DeleteBucketCommand")
    .sc(schemas_0.DeleteBucket$)
    .build() {
}

class DeleteBucketCorsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketCors", {})
    .n("S3Client", "DeleteBucketCorsCommand")
    .sc(schemas_0.DeleteBucketCors$)
    .build() {
}

class DeleteBucketEncryptionCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketEncryption", {})
    .n("S3Client", "DeleteBucketEncryptionCommand")
    .sc(schemas_0.DeleteBucketEncryption$)
    .build() {
}

class DeleteBucketIntelligentTieringConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketIntelligentTieringConfiguration", {})
    .n("S3Client", "DeleteBucketIntelligentTieringConfigurationCommand")
    .sc(schemas_0.DeleteBucketIntelligentTieringConfiguration$)
    .build() {
}

class DeleteBucketInventoryConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketInventoryConfiguration", {})
    .n("S3Client", "DeleteBucketInventoryConfigurationCommand")
    .sc(schemas_0.DeleteBucketInventoryConfiguration$)
    .build() {
}

class DeleteBucketLifecycleCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketLifecycle", {})
    .n("S3Client", "DeleteBucketLifecycleCommand")
    .sc(schemas_0.DeleteBucketLifecycle$)
    .build() {
}

class DeleteBucketMetadataConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketMetadataConfiguration", {})
    .n("S3Client", "DeleteBucketMetadataConfigurationCommand")
    .sc(schemas_0.DeleteBucketMetadataConfiguration$)
    .build() {
}

class DeleteBucketMetadataTableConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketMetadataTableConfiguration", {})
    .n("S3Client", "DeleteBucketMetadataTableConfigurationCommand")
    .sc(schemas_0.DeleteBucketMetadataTableConfiguration$)
    .build() {
}

class DeleteBucketMetricsConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketMetricsConfiguration", {})
    .n("S3Client", "DeleteBucketMetricsConfigurationCommand")
    .sc(schemas_0.DeleteBucketMetricsConfiguration$)
    .build() {
}

class DeleteBucketOwnershipControlsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketOwnershipControls", {})
    .n("S3Client", "DeleteBucketOwnershipControlsCommand")
    .sc(schemas_0.DeleteBucketOwnershipControls$)
    .build() {
}

class DeleteBucketPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketPolicy", {})
    .n("S3Client", "DeleteBucketPolicyCommand")
    .sc(schemas_0.DeleteBucketPolicy$)
    .build() {
}

class DeleteBucketReplicationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketReplication", {})
    .n("S3Client", "DeleteBucketReplicationCommand")
    .sc(schemas_0.DeleteBucketReplication$)
    .build() {
}

class DeleteBucketTaggingCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketTagging", {})
    .n("S3Client", "DeleteBucketTaggingCommand")
    .sc(schemas_0.DeleteBucketTagging$)
    .build() {
}

class DeleteBucketWebsiteCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeleteBucketWebsite", {})
    .n("S3Client", "DeleteBucketWebsiteCommand")
    .sc(schemas_0.DeleteBucketWebsite$)
    .build() {
}

class DeleteObjectCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Key: { type: "contextParams", name: "Key" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "DeleteObject", {})
    .n("S3Client", "DeleteObjectCommand")
    .sc(schemas_0.DeleteObject$)
    .build() {
}

class DeleteObjectsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "DeleteObjects", {})
    .n("S3Client", "DeleteObjectsCommand")
    .sc(schemas_0.DeleteObjects$)
    .build() {
}

class DeleteObjectTaggingCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "DeleteObjectTagging", {})
    .n("S3Client", "DeleteObjectTaggingCommand")
    .sc(schemas_0.DeleteObjectTagging$)
    .build() {
}

class DeletePublicAccessBlockCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "DeletePublicAccessBlock", {})
    .n("S3Client", "DeletePublicAccessBlockCommand")
    .sc(schemas_0.DeletePublicAccessBlock$)
    .build() {
}

class GetBucketAbacCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketAbac", {})
    .n("S3Client", "GetBucketAbacCommand")
    .sc(schemas_0.GetBucketAbac$)
    .build() {
}

class GetBucketAccelerateConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketAccelerateConfiguration", {})
    .n("S3Client", "GetBucketAccelerateConfigurationCommand")
    .sc(schemas_0.GetBucketAccelerateConfiguration$)
    .build() {
}

class GetBucketAclCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketAcl", {})
    .n("S3Client", "GetBucketAclCommand")
    .sc(schemas_0.GetBucketAcl$)
    .build() {
}

class GetBucketAnalyticsConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketAnalyticsConfiguration", {})
    .n("S3Client", "GetBucketAnalyticsConfigurationCommand")
    .sc(schemas_0.GetBucketAnalyticsConfiguration$)
    .build() {
}

class GetBucketCorsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketCors", {})
    .n("S3Client", "GetBucketCorsCommand")
    .sc(schemas_0.GetBucketCors$)
    .build() {
}

class GetBucketEncryptionCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketEncryption", {})
    .n("S3Client", "GetBucketEncryptionCommand")
    .sc(schemas_0.GetBucketEncryption$)
    .build() {
}

class GetBucketIntelligentTieringConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketIntelligentTieringConfiguration", {})
    .n("S3Client", "GetBucketIntelligentTieringConfigurationCommand")
    .sc(schemas_0.GetBucketIntelligentTieringConfiguration$)
    .build() {
}

class GetBucketInventoryConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketInventoryConfiguration", {})
    .n("S3Client", "GetBucketInventoryConfigurationCommand")
    .sc(schemas_0.GetBucketInventoryConfiguration$)
    .build() {
}

class GetBucketLifecycleConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketLifecycleConfiguration", {})
    .n("S3Client", "GetBucketLifecycleConfigurationCommand")
    .sc(schemas_0.GetBucketLifecycleConfiguration$)
    .build() {
}

class GetBucketLocationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketLocation", {})
    .n("S3Client", "GetBucketLocationCommand")
    .sc(schemas_0.GetBucketLocation$)
    .build() {
}

class GetBucketLoggingCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketLogging", {})
    .n("S3Client", "GetBucketLoggingCommand")
    .sc(schemas_0.GetBucketLogging$)
    .build() {
}

class GetBucketMetadataConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketMetadataConfiguration", {})
    .n("S3Client", "GetBucketMetadataConfigurationCommand")
    .sc(schemas_0.GetBucketMetadataConfiguration$)
    .build() {
}

class GetBucketMetadataTableConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketMetadataTableConfiguration", {})
    .n("S3Client", "GetBucketMetadataTableConfigurationCommand")
    .sc(schemas_0.GetBucketMetadataTableConfiguration$)
    .build() {
}

class GetBucketMetricsConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketMetricsConfiguration", {})
    .n("S3Client", "GetBucketMetricsConfigurationCommand")
    .sc(schemas_0.GetBucketMetricsConfiguration$)
    .build() {
}

class GetBucketNotificationConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketNotificationConfiguration", {})
    .n("S3Client", "GetBucketNotificationConfigurationCommand")
    .sc(schemas_0.GetBucketNotificationConfiguration$)
    .build() {
}

class GetBucketOwnershipControlsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketOwnershipControls", {})
    .n("S3Client", "GetBucketOwnershipControlsCommand")
    .sc(schemas_0.GetBucketOwnershipControls$)
    .build() {
}

class GetBucketPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketPolicy", {})
    .n("S3Client", "GetBucketPolicyCommand")
    .sc(schemas_0.GetBucketPolicy$)
    .build() {
}

class GetBucketPolicyStatusCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketPolicyStatus", {})
    .n("S3Client", "GetBucketPolicyStatusCommand")
    .sc(schemas_0.GetBucketPolicyStatus$)
    .build() {
}

class GetBucketReplicationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketReplication", {})
    .n("S3Client", "GetBucketReplicationCommand")
    .sc(schemas_0.GetBucketReplication$)
    .build() {
}

class GetBucketRequestPaymentCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketRequestPayment", {})
    .n("S3Client", "GetBucketRequestPaymentCommand")
    .sc(schemas_0.GetBucketRequestPayment$)
    .build() {
}

class GetBucketTaggingCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketTagging", {})
    .n("S3Client", "GetBucketTaggingCommand")
    .sc(schemas_0.GetBucketTagging$)
    .build() {
}

class GetBucketVersioningCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketVersioning", {})
    .n("S3Client", "GetBucketVersioningCommand")
    .sc(schemas_0.GetBucketVersioning$)
    .build() {
}

class GetBucketWebsiteCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetBucketWebsite", {})
    .n("S3Client", "GetBucketWebsiteCommand")
    .sc(schemas_0.GetBucketWebsite$)
    .build() {
}

class GetObjectAclCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Key: { type: "contextParams", name: "Key" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetObjectAcl", {})
    .n("S3Client", "GetObjectAclCommand")
    .sc(schemas_0.GetObjectAcl$)
    .build() {
}

class GetObjectAttributesCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
        middlewareSsec.getSsecPlugin(config),
    ];
})
    .s("AmazonS3", "GetObjectAttributes", {})
    .n("S3Client", "GetObjectAttributesCommand")
    .sc(schemas_0.GetObjectAttributes$)
    .build() {
}

class GetObjectCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Key: { type: "contextParams", name: "Key" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestChecksumRequired: false,
            requestValidationModeMember: 'ChecksumMode',
            'responseAlgorithms': ['CRC64NVME', 'CRC32', 'CRC32C', 'SHA256', 'SHA1'],
        }),
        middlewareSsec.getSsecPlugin(config),
        middlewareSdkS3.getS3ExpiresMiddlewarePlugin(config),
    ];
})
    .s("AmazonS3", "GetObject", {})
    .n("S3Client", "GetObjectCommand")
    .sc(schemas_0.GetObject$)
    .build() {
}

class GetObjectLegalHoldCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetObjectLegalHold", {})
    .n("S3Client", "GetObjectLegalHoldCommand")
    .sc(schemas_0.GetObjectLegalHold$)
    .build() {
}

class GetObjectLockConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetObjectLockConfiguration", {})
    .n("S3Client", "GetObjectLockConfigurationCommand")
    .sc(schemas_0.GetObjectLockConfiguration$)
    .build() {
}

class GetObjectRetentionCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetObjectRetention", {})
    .n("S3Client", "GetObjectRetentionCommand")
    .sc(schemas_0.GetObjectRetention$)
    .build() {
}

class GetObjectTaggingCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetObjectTagging", {})
    .n("S3Client", "GetObjectTaggingCommand")
    .sc(schemas_0.GetObjectTagging$)
    .build() {
}

class GetObjectTorrentCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "GetObjectTorrent", {})
    .n("S3Client", "GetObjectTorrentCommand")
    .sc(schemas_0.GetObjectTorrent$)
    .build() {
}

class GetPublicAccessBlockCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "GetPublicAccessBlock", {})
    .n("S3Client", "GetPublicAccessBlockCommand")
    .sc(schemas_0.GetPublicAccessBlock$)
    .build() {
}

class HeadBucketCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "HeadBucket", {})
    .n("S3Client", "HeadBucketCommand")
    .sc(schemas_0.HeadBucket$)
    .build() {
}

class HeadObjectCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Key: { type: "contextParams", name: "Key" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
        middlewareSsec.getSsecPlugin(config),
        middlewareSdkS3.getS3ExpiresMiddlewarePlugin(config),
    ];
})
    .s("AmazonS3", "HeadObject", {})
    .n("S3Client", "HeadObjectCommand")
    .sc(schemas_0.HeadObject$)
    .build() {
}

class ListBucketAnalyticsConfigurationsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "ListBucketAnalyticsConfigurations", {})
    .n("S3Client", "ListBucketAnalyticsConfigurationsCommand")
    .sc(schemas_0.ListBucketAnalyticsConfigurations$)
    .build() {
}

class ListBucketIntelligentTieringConfigurationsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "ListBucketIntelligentTieringConfigurations", {})
    .n("S3Client", "ListBucketIntelligentTieringConfigurationsCommand")
    .sc(schemas_0.ListBucketIntelligentTieringConfigurations$)
    .build() {
}

class ListBucketInventoryConfigurationsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "ListBucketInventoryConfigurations", {})
    .n("S3Client", "ListBucketInventoryConfigurationsCommand")
    .sc(schemas_0.ListBucketInventoryConfigurations$)
    .build() {
}

class ListBucketMetricsConfigurationsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "ListBucketMetricsConfigurations", {})
    .n("S3Client", "ListBucketMetricsConfigurationsCommand")
    .sc(schemas_0.ListBucketMetricsConfigurations$)
    .build() {
}

class ListBucketsCommand extends smithyClient.Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "ListBuckets", {})
    .n("S3Client", "ListBucketsCommand")
    .sc(schemas_0.ListBuckets$)
    .build() {
}

class ListDirectoryBucketsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "ListDirectoryBuckets", {})
    .n("S3Client", "ListDirectoryBucketsCommand")
    .sc(schemas_0.ListDirectoryBuckets$)
    .build() {
}

class ListMultipartUploadsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Prefix: { type: "contextParams", name: "Prefix" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "ListMultipartUploads", {})
    .n("S3Client", "ListMultipartUploadsCommand")
    .sc(schemas_0.ListMultipartUploads$)
    .build() {
}

class ListObjectsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Prefix: { type: "contextParams", name: "Prefix" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "ListObjects", {})
    .n("S3Client", "ListObjectsCommand")
    .sc(schemas_0.ListObjects$)
    .build() {
}

class ListObjectsV2Command extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Prefix: { type: "contextParams", name: "Prefix" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "ListObjectsV2", {})
    .n("S3Client", "ListObjectsV2Command")
    .sc(schemas_0.ListObjectsV2$)
    .build() {
}

class ListObjectVersionsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Prefix: { type: "contextParams", name: "Prefix" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "ListObjectVersions", {})
    .n("S3Client", "ListObjectVersionsCommand")
    .sc(schemas_0.ListObjectVersions$)
    .build() {
}

class ListPartsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Key: { type: "contextParams", name: "Key" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
        middlewareSsec.getSsecPlugin(config),
    ];
})
    .s("AmazonS3", "ListParts", {})
    .n("S3Client", "ListPartsCommand")
    .sc(schemas_0.ListParts$)
    .build() {
}

class PutBucketAbacCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: false,
        }),
    ];
})
    .s("AmazonS3", "PutBucketAbac", {})
    .n("S3Client", "PutBucketAbacCommand")
    .sc(schemas_0.PutBucketAbac$)
    .build() {
}

class PutBucketAccelerateConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: false,
        }),
    ];
})
    .s("AmazonS3", "PutBucketAccelerateConfiguration", {})
    .n("S3Client", "PutBucketAccelerateConfigurationCommand")
    .sc(schemas_0.PutBucketAccelerateConfiguration$)
    .build() {
}

class PutBucketAclCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "PutBucketAcl", {})
    .n("S3Client", "PutBucketAclCommand")
    .sc(schemas_0.PutBucketAcl$)
    .build() {
}

class PutBucketAnalyticsConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "PutBucketAnalyticsConfiguration", {})
    .n("S3Client", "PutBucketAnalyticsConfigurationCommand")
    .sc(schemas_0.PutBucketAnalyticsConfiguration$)
    .build() {
}

class PutBucketCorsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "PutBucketCors", {})
    .n("S3Client", "PutBucketCorsCommand")
    .sc(schemas_0.PutBucketCors$)
    .build() {
}

class PutBucketEncryptionCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "PutBucketEncryption", {})
    .n("S3Client", "PutBucketEncryptionCommand")
    .sc(schemas_0.PutBucketEncryption$)
    .build() {
}

class PutBucketIntelligentTieringConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "PutBucketIntelligentTieringConfiguration", {})
    .n("S3Client", "PutBucketIntelligentTieringConfigurationCommand")
    .sc(schemas_0.PutBucketIntelligentTieringConfiguration$)
    .build() {
}

class PutBucketInventoryConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "PutBucketInventoryConfiguration", {})
    .n("S3Client", "PutBucketInventoryConfigurationCommand")
    .sc(schemas_0.PutBucketInventoryConfiguration$)
    .build() {
}

class PutBucketLifecycleConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "PutBucketLifecycleConfiguration", {})
    .n("S3Client", "PutBucketLifecycleConfigurationCommand")
    .sc(schemas_0.PutBucketLifecycleConfiguration$)
    .build() {
}

class PutBucketLoggingCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "PutBucketLogging", {})
    .n("S3Client", "PutBucketLoggingCommand")
    .sc(schemas_0.PutBucketLogging$)
    .build() {
}

class PutBucketMetricsConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "PutBucketMetricsConfiguration", {})
    .n("S3Client", "PutBucketMetricsConfigurationCommand")
    .sc(schemas_0.PutBucketMetricsConfiguration$)
    .build() {
}

class PutBucketNotificationConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "PutBucketNotificationConfiguration", {})
    .n("S3Client", "PutBucketNotificationConfigurationCommand")
    .sc(schemas_0.PutBucketNotificationConfiguration$)
    .build() {
}

class PutBucketOwnershipControlsCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "PutBucketOwnershipControls", {})
    .n("S3Client", "PutBucketOwnershipControlsCommand")
    .sc(schemas_0.PutBucketOwnershipControls$)
    .build() {
}

class PutBucketPolicyCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "PutBucketPolicy", {})
    .n("S3Client", "PutBucketPolicyCommand")
    .sc(schemas_0.PutBucketPolicy$)
    .build() {
}

class PutBucketReplicationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "PutBucketReplication", {})
    .n("S3Client", "PutBucketReplicationCommand")
    .sc(schemas_0.PutBucketReplication$)
    .build() {
}

class PutBucketRequestPaymentCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "PutBucketRequestPayment", {})
    .n("S3Client", "PutBucketRequestPaymentCommand")
    .sc(schemas_0.PutBucketRequestPayment$)
    .build() {
}

class PutBucketTaggingCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "PutBucketTagging", {})
    .n("S3Client", "PutBucketTaggingCommand")
    .sc(schemas_0.PutBucketTagging$)
    .build() {
}

class PutBucketVersioningCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "PutBucketVersioning", {})
    .n("S3Client", "PutBucketVersioningCommand")
    .sc(schemas_0.PutBucketVersioning$)
    .build() {
}

class PutBucketWebsiteCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "PutBucketWebsite", {})
    .n("S3Client", "PutBucketWebsiteCommand")
    .sc(schemas_0.PutBucketWebsite$)
    .build() {
}

class PutObjectAclCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Key: { type: "contextParams", name: "Key" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "PutObjectAcl", {})
    .n("S3Client", "PutObjectAclCommand")
    .sc(schemas_0.PutObjectAcl$)
    .build() {
}

class PutObjectCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Key: { type: "contextParams", name: "Key" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: false,
        }),
        middlewareSdkS3.getCheckContentLengthHeaderPlugin(config),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
        middlewareSsec.getSsecPlugin(config),
    ];
})
    .s("AmazonS3", "PutObject", {})
    .n("S3Client", "PutObjectCommand")
    .sc(schemas_0.PutObject$)
    .build() {
}

class PutObjectLegalHoldCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "PutObjectLegalHold", {})
    .n("S3Client", "PutObjectLegalHoldCommand")
    .sc(schemas_0.PutObjectLegalHold$)
    .build() {
}

class PutObjectLockConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "PutObjectLockConfiguration", {})
    .n("S3Client", "PutObjectLockConfigurationCommand")
    .sc(schemas_0.PutObjectLockConfiguration$)
    .build() {
}

class PutObjectRetentionCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "PutObjectRetention", {})
    .n("S3Client", "PutObjectRetentionCommand")
    .sc(schemas_0.PutObjectRetention$)
    .build() {
}

class PutObjectTaggingCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "PutObjectTagging", {})
    .n("S3Client", "PutObjectTaggingCommand")
    .sc(schemas_0.PutObjectTagging$)
    .build() {
}

class PutPublicAccessBlockCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "PutPublicAccessBlock", {})
    .n("S3Client", "PutPublicAccessBlockCommand")
    .sc(schemas_0.PutPublicAccessBlock$)
    .build() {
}

class RenameObjectCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Key: { type: "contextParams", name: "Key" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "RenameObject", {})
    .n("S3Client", "RenameObjectCommand")
    .sc(schemas_0.RenameObject$)
    .build() {
}

class RestoreObjectCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: false,
        }),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "RestoreObject", {})
    .n("S3Client", "RestoreObjectCommand")
    .sc(schemas_0.RestoreObject$)
    .build() {
}

class SelectObjectContentCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
        middlewareSsec.getSsecPlugin(config),
    ];
})
    .s("AmazonS3", "SelectObjectContent", {
    eventStream: {
        output: true,
    },
})
    .n("S3Client", "SelectObjectContentCommand")
    .sc(schemas_0.SelectObjectContent$)
    .build() {
}

class UpdateBucketMetadataInventoryTableConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "UpdateBucketMetadataInventoryTableConfiguration", {})
    .n("S3Client", "UpdateBucketMetadataInventoryTableConfigurationCommand")
    .sc(schemas_0.UpdateBucketMetadataInventoryTableConfiguration$)
    .build() {
}

class UpdateBucketMetadataJournalTableConfigurationCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseS3ExpressControlEndpoint: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
    ];
})
    .s("AmazonS3", "UpdateBucketMetadataJournalTableConfiguration", {})
    .n("S3Client", "UpdateBucketMetadataJournalTableConfigurationCommand")
    .sc(schemas_0.UpdateBucketMetadataJournalTableConfiguration$)
    .build() {
}

class UpdateObjectEncryptionCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: true,
        }),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
    ];
})
    .s("AmazonS3", "UpdateObjectEncryption", {})
    .n("S3Client", "UpdateObjectEncryptionCommand")
    .sc(schemas_0.UpdateObjectEncryption$)
    .build() {
}

class UploadPartCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    Bucket: { type: "contextParams", name: "Bucket" },
    Key: { type: "contextParams", name: "Key" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareFlexibleChecksums.getFlexibleChecksumsPlugin(config, {
            requestAlgorithmMember: { 'httpHeader': 'x-amz-sdk-checksum-algorithm', 'name': 'ChecksumAlgorithm' },
            requestChecksumRequired: false,
        }),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
        middlewareSsec.getSsecPlugin(config),
    ];
})
    .s("AmazonS3", "UploadPart", {})
    .n("S3Client", "UploadPartCommand")
    .sc(schemas_0.UploadPart$)
    .build() {
}

class UploadPartCopyCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    DisableS3ExpressSessionAuth: { type: "staticContextParams", value: true },
    Bucket: { type: "contextParams", name: "Bucket" },
})
    .m(function (Command, cs, config, o) {
    return [
        middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
        middlewareSdkS3.getThrow200ExceptionsPlugin(config),
        middlewareSsec.getSsecPlugin(config),
    ];
})
    .s("AmazonS3", "UploadPartCopy", {})
    .n("S3Client", "UploadPartCopyCommand")
    .sc(schemas_0.UploadPartCopy$)
    .build() {
}

class WriteGetObjectResponseCommand extends smithyClient.Command
    .classBuilder()
    .ep({
    ...commonParams,
    UseObjectLambdaEndpoint: { type: "staticContextParams", value: true },
})
    .m(function (Command, cs, config, o) {
    return [middlewareEndpoint.getEndpointPlugin(config, Command.getEndpointParameterInstructions())];
})
    .s("AmazonS3", "WriteGetObjectResponse", {})
    .n("S3Client", "WriteGetObjectResponseCommand")
    .sc(schemas_0.WriteGetObjectResponse$)
    .build() {
}

const paginateListBuckets = core.createPaginator(S3Client, ListBucketsCommand, "ContinuationToken", "ContinuationToken", "MaxBuckets");

const paginateListDirectoryBuckets = core.createPaginator(S3Client, ListDirectoryBucketsCommand, "ContinuationToken", "ContinuationToken", "MaxDirectoryBuckets");

const paginateListObjectsV2 = core.createPaginator(S3Client, ListObjectsV2Command, "ContinuationToken", "NextContinuationToken", "MaxKeys");

const paginateListParts = core.createPaginator(S3Client, ListPartsCommand, "PartNumberMarker", "NextPartNumberMarker", "MaxParts");

const checkState$3 = async (client, input) => {
    let reason;
    try {
        let result = await client.send(new HeadBucketCommand(input));
        reason = result;
        return { state: utilWaiter.WaiterState.SUCCESS, reason };
    }
    catch (exception) {
        reason = exception;
        if (exception.name && exception.name == "NotFound") {
            return { state: utilWaiter.WaiterState.RETRY, reason };
        }
    }
    return { state: utilWaiter.WaiterState.RETRY, reason };
};
const waitForBucketExists = async (params, input) => {
    const serviceDefaults = { minDelay: 5, maxDelay: 120 };
    return utilWaiter.createWaiter({ ...serviceDefaults, ...params }, input, checkState$3);
};
const waitUntilBucketExists = async (params, input) => {
    const serviceDefaults = { minDelay: 5, maxDelay: 120 };
    const result = await utilWaiter.createWaiter({ ...serviceDefaults, ...params }, input, checkState$3);
    return utilWaiter.checkExceptions(result);
};

const checkState$2 = async (client, input) => {
    let reason;
    try {
        let result = await client.send(new HeadBucketCommand(input));
        reason = result;
    }
    catch (exception) {
        reason = exception;
        if (exception.name && exception.name == "NotFound") {
            return { state: utilWaiter.WaiterState.SUCCESS, reason };
        }
    }
    return { state: utilWaiter.WaiterState.RETRY, reason };
};
const waitForBucketNotExists = async (params, input) => {
    const serviceDefaults = { minDelay: 5, maxDelay: 120 };
    return utilWaiter.createWaiter({ ...serviceDefaults, ...params }, input, checkState$2);
};
const waitUntilBucketNotExists = async (params, input) => {
    const serviceDefaults = { minDelay: 5, maxDelay: 120 };
    const result = await utilWaiter.createWaiter({ ...serviceDefaults, ...params }, input, checkState$2);
    return utilWaiter.checkExceptions(result);
};

const checkState$1 = async (client, input) => {
    let reason;
    try {
        let result = await client.send(new HeadObjectCommand(input));
        reason = result;
        return { state: utilWaiter.WaiterState.SUCCESS, reason };
    }
    catch (exception) {
        reason = exception;
        if (exception.name && exception.name == "NotFound") {
            return { state: utilWaiter.WaiterState.RETRY, reason };
        }
    }
    return { state: utilWaiter.WaiterState.RETRY, reason };
};
const waitForObjectExists = async (params, input) => {
    const serviceDefaults = { minDelay: 5, maxDelay: 120 };
    return utilWaiter.createWaiter({ ...serviceDefaults, ...params }, input, checkState$1);
};
const waitUntilObjectExists = async (params, input) => {
    const serviceDefaults = { minDelay: 5, maxDelay: 120 };
    const result = await utilWaiter.createWaiter({ ...serviceDefaults, ...params }, input, checkState$1);
    return utilWaiter.checkExceptions(result);
};

const checkState = async (client, input) => {
    let reason;
    try {
        let result = await client.send(new HeadObjectCommand(input));
        reason = result;
    }
    catch (exception) {
        reason = exception;
        if (exception.name && exception.name == "NotFound") {
            return { state: utilWaiter.WaiterState.SUCCESS, reason };
        }
    }
    return { state: utilWaiter.WaiterState.RETRY, reason };
};
const waitForObjectNotExists = async (params, input) => {
    const serviceDefaults = { minDelay: 5, maxDelay: 120 };
    return utilWaiter.createWaiter({ ...serviceDefaults, ...params }, input, checkState);
};
const waitUntilObjectNotExists = async (params, input) => {
    const serviceDefaults = { minDelay: 5, maxDelay: 120 };
    const result = await utilWaiter.createWaiter({ ...serviceDefaults, ...params }, input, checkState);
    return utilWaiter.checkExceptions(result);
};

const commands = {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CopyObjectCommand,
    CreateBucketCommand,
    CreateBucketMetadataConfigurationCommand,
    CreateBucketMetadataTableConfigurationCommand,
    CreateMultipartUploadCommand,
    CreateSessionCommand,
    DeleteBucketCommand,
    DeleteBucketAnalyticsConfigurationCommand,
    DeleteBucketCorsCommand,
    DeleteBucketEncryptionCommand,
    DeleteBucketIntelligentTieringConfigurationCommand,
    DeleteBucketInventoryConfigurationCommand,
    DeleteBucketLifecycleCommand,
    DeleteBucketMetadataConfigurationCommand,
    DeleteBucketMetadataTableConfigurationCommand,
    DeleteBucketMetricsConfigurationCommand,
    DeleteBucketOwnershipControlsCommand,
    DeleteBucketPolicyCommand,
    DeleteBucketReplicationCommand,
    DeleteBucketTaggingCommand,
    DeleteBucketWebsiteCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    DeleteObjectTaggingCommand,
    DeletePublicAccessBlockCommand,
    GetBucketAbacCommand,
    GetBucketAccelerateConfigurationCommand,
    GetBucketAclCommand,
    GetBucketAnalyticsConfigurationCommand,
    GetBucketCorsCommand,
    GetBucketEncryptionCommand,
    GetBucketIntelligentTieringConfigurationCommand,
    GetBucketInventoryConfigurationCommand,
    GetBucketLifecycleConfigurationCommand,
    GetBucketLocationCommand,
    GetBucketLoggingCommand,
    GetBucketMetadataConfigurationCommand,
    GetBucketMetadataTableConfigurationCommand,
    GetBucketMetricsConfigurationCommand,
    GetBucketNotificationConfigurationCommand,
    GetBucketOwnershipControlsCommand,
    GetBucketPolicyCommand,
    GetBucketPolicyStatusCommand,
    GetBucketReplicationCommand,
    GetBucketRequestPaymentCommand,
    GetBucketTaggingCommand,
    GetBucketVersioningCommand,
    GetBucketWebsiteCommand,
    GetObjectCommand,
    GetObjectAclCommand,
    GetObjectAttributesCommand,
    GetObjectLegalHoldCommand,
    GetObjectLockConfigurationCommand,
    GetObjectRetentionCommand,
    GetObjectTaggingCommand,
    GetObjectTorrentCommand,
    GetPublicAccessBlockCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    ListBucketAnalyticsConfigurationsCommand,
    ListBucketIntelligentTieringConfigurationsCommand,
    ListBucketInventoryConfigurationsCommand,
    ListBucketMetricsConfigurationsCommand,
    ListBucketsCommand,
    ListDirectoryBucketsCommand,
    ListMultipartUploadsCommand,
    ListObjectsCommand,
    ListObjectsV2Command,
    ListObjectVersionsCommand,
    ListPartsCommand,
    PutBucketAbacCommand,
    PutBucketAccelerateConfigurationCommand,
    PutBucketAclCommand,
    PutBucketAnalyticsConfigurationCommand,
    PutBucketCorsCommand,
    PutBucketEncryptionCommand,
    PutBucketIntelligentTieringConfigurationCommand,
    PutBucketInventoryConfigurationCommand,
    PutBucketLifecycleConfigurationCommand,
    PutBucketLoggingCommand,
    PutBucketMetricsConfigurationCommand,
    PutBucketNotificationConfigurationCommand,
    PutBucketOwnershipControlsCommand,
    PutBucketPolicyCommand,
    PutBucketReplicationCommand,
    PutBucketRequestPaymentCommand,
    PutBucketTaggingCommand,
    PutBucketVersioningCommand,
    PutBucketWebsiteCommand,
    PutObjectCommand,
    PutObjectAclCommand,
    PutObjectLegalHoldCommand,
    PutObjectLockConfigurationCommand,
    PutObjectRetentionCommand,
    PutObjectTaggingCommand,
    PutPublicAccessBlockCommand,
    RenameObjectCommand,
    RestoreObjectCommand,
    SelectObjectContentCommand,
    UpdateBucketMetadataInventoryTableConfigurationCommand,
    UpdateBucketMetadataJournalTableConfigurationCommand,
    UpdateObjectEncryptionCommand,
    UploadPartCommand,
    UploadPartCopyCommand,
    WriteGetObjectResponseCommand,
};
const paginators = {
    paginateListBuckets,
    paginateListDirectoryBuckets,
    paginateListObjectsV2,
    paginateListParts,
};
const waiters = {
    waitUntilBucketExists,
    waitUntilBucketNotExists,
    waitUntilObjectExists,
    waitUntilObjectNotExists,
};
class S3 extends S3Client {
}
smithyClient.createAggregatedClient(commands, S3, { paginators, waiters });

const BucketAbacStatus = {
    Disabled: "Disabled",
    Enabled: "Enabled",
};
const RequestCharged = {
    requester: "requester",
};
const RequestPayer = {
    requester: "requester",
};
const BucketAccelerateStatus = {
    Enabled: "Enabled",
    Suspended: "Suspended",
};
const Type = {
    AmazonCustomerByEmail: "AmazonCustomerByEmail",
    CanonicalUser: "CanonicalUser",
    Group: "Group",
};
const Permission = {
    FULL_CONTROL: "FULL_CONTROL",
    READ: "READ",
    READ_ACP: "READ_ACP",
    WRITE: "WRITE",
    WRITE_ACP: "WRITE_ACP",
};
const OwnerOverride = {
    Destination: "Destination",
};
const ChecksumType = {
    COMPOSITE: "COMPOSITE",
    FULL_OBJECT: "FULL_OBJECT",
};
const ServerSideEncryption = {
    AES256: "AES256",
    aws_fsx: "aws:fsx",
    aws_kms: "aws:kms",
    aws_kms_dsse: "aws:kms:dsse",
};
const ObjectCannedACL = {
    authenticated_read: "authenticated-read",
    aws_exec_read: "aws-exec-read",
    bucket_owner_full_control: "bucket-owner-full-control",
    bucket_owner_read: "bucket-owner-read",
    private: "private",
    public_read: "public-read",
    public_read_write: "public-read-write",
};
const ChecksumAlgorithm = {
    CRC32: "CRC32",
    CRC32C: "CRC32C",
    CRC64NVME: "CRC64NVME",
    SHA1: "SHA1",
    SHA256: "SHA256",
};
const MetadataDirective = {
    COPY: "COPY",
    REPLACE: "REPLACE",
};
const ObjectLockLegalHoldStatus = {
    OFF: "OFF",
    ON: "ON",
};
const ObjectLockMode = {
    COMPLIANCE: "COMPLIANCE",
    GOVERNANCE: "GOVERNANCE",
};
const StorageClass = {
    DEEP_ARCHIVE: "DEEP_ARCHIVE",
    EXPRESS_ONEZONE: "EXPRESS_ONEZONE",
    FSX_ONTAP: "FSX_ONTAP",
    FSX_OPENZFS: "FSX_OPENZFS",
    GLACIER: "GLACIER",
    GLACIER_IR: "GLACIER_IR",
    INTELLIGENT_TIERING: "INTELLIGENT_TIERING",
    ONEZONE_IA: "ONEZONE_IA",
    OUTPOSTS: "OUTPOSTS",
    REDUCED_REDUNDANCY: "REDUCED_REDUNDANCY",
    SNOW: "SNOW",
    STANDARD: "STANDARD",
    STANDARD_IA: "STANDARD_IA",
};
const TaggingDirective = {
    COPY: "COPY",
    REPLACE: "REPLACE",
};
const BucketCannedACL = {
    authenticated_read: "authenticated-read",
    private: "private",
    public_read: "public-read",
    public_read_write: "public-read-write",
};
const DataRedundancy = {
    SingleAvailabilityZone: "SingleAvailabilityZone",
    SingleLocalZone: "SingleLocalZone",
};
const BucketType = {
    Directory: "Directory",
};
const LocationType = {
    AvailabilityZone: "AvailabilityZone",
    LocalZone: "LocalZone",
};
const BucketLocationConstraint = {
    EU: "EU",
    af_south_1: "af-south-1",
    ap_east_1: "ap-east-1",
    ap_northeast_1: "ap-northeast-1",
    ap_northeast_2: "ap-northeast-2",
    ap_northeast_3: "ap-northeast-3",
    ap_south_1: "ap-south-1",
    ap_south_2: "ap-south-2",
    ap_southeast_1: "ap-southeast-1",
    ap_southeast_2: "ap-southeast-2",
    ap_southeast_3: "ap-southeast-3",
    ap_southeast_4: "ap-southeast-4",
    ap_southeast_5: "ap-southeast-5",
    ca_central_1: "ca-central-1",
    cn_north_1: "cn-north-1",
    cn_northwest_1: "cn-northwest-1",
    eu_central_1: "eu-central-1",
    eu_central_2: "eu-central-2",
    eu_north_1: "eu-north-1",
    eu_south_1: "eu-south-1",
    eu_south_2: "eu-south-2",
    eu_west_1: "eu-west-1",
    eu_west_2: "eu-west-2",
    eu_west_3: "eu-west-3",
    il_central_1: "il-central-1",
    me_central_1: "me-central-1",
    me_south_1: "me-south-1",
    sa_east_1: "sa-east-1",
    us_east_2: "us-east-2",
    us_gov_east_1: "us-gov-east-1",
    us_gov_west_1: "us-gov-west-1",
    us_west_1: "us-west-1",
    us_west_2: "us-west-2",
};
const ObjectOwnership = {
    BucketOwnerEnforced: "BucketOwnerEnforced",
    BucketOwnerPreferred: "BucketOwnerPreferred",
    ObjectWriter: "ObjectWriter",
};
const InventoryConfigurationState = {
    DISABLED: "DISABLED",
    ENABLED: "ENABLED",
};
const TableSseAlgorithm = {
    AES256: "AES256",
    aws_kms: "aws:kms",
};
const ExpirationState = {
    DISABLED: "DISABLED",
    ENABLED: "ENABLED",
};
const SessionMode = {
    ReadOnly: "ReadOnly",
    ReadWrite: "ReadWrite",
};
const AnalyticsS3ExportFileFormat = {
    CSV: "CSV",
};
const StorageClassAnalysisSchemaVersion = {
    V_1: "V_1",
};
const EncryptionType = {
    NONE: "NONE",
    SSE_C: "SSE-C",
};
const IntelligentTieringStatus = {
    Disabled: "Disabled",
    Enabled: "Enabled",
};
const IntelligentTieringAccessTier = {
    ARCHIVE_ACCESS: "ARCHIVE_ACCESS",
    DEEP_ARCHIVE_ACCESS: "DEEP_ARCHIVE_ACCESS",
};
const InventoryFormat = {
    CSV: "CSV",
    ORC: "ORC",
    Parquet: "Parquet",
};
const InventoryIncludedObjectVersions = {
    All: "All",
    Current: "Current",
};
const InventoryOptionalField = {
    BucketKeyStatus: "BucketKeyStatus",
    ChecksumAlgorithm: "ChecksumAlgorithm",
    ETag: "ETag",
    EncryptionStatus: "EncryptionStatus",
    IntelligentTieringAccessTier: "IntelligentTieringAccessTier",
    IsMultipartUploaded: "IsMultipartUploaded",
    LastModifiedDate: "LastModifiedDate",
    LifecycleExpirationDate: "LifecycleExpirationDate",
    ObjectAccessControlList: "ObjectAccessControlList",
    ObjectLockLegalHoldStatus: "ObjectLockLegalHoldStatus",
    ObjectLockMode: "ObjectLockMode",
    ObjectLockRetainUntilDate: "ObjectLockRetainUntilDate",
    ObjectOwner: "ObjectOwner",
    ReplicationStatus: "ReplicationStatus",
    Size: "Size",
    StorageClass: "StorageClass",
};
const InventoryFrequency = {
    Daily: "Daily",
    Weekly: "Weekly",
};
const TransitionStorageClass = {
    DEEP_ARCHIVE: "DEEP_ARCHIVE",
    GLACIER: "GLACIER",
    GLACIER_IR: "GLACIER_IR",
    INTELLIGENT_TIERING: "INTELLIGENT_TIERING",
    ONEZONE_IA: "ONEZONE_IA",
    STANDARD_IA: "STANDARD_IA",
};
const ExpirationStatus = {
    Disabled: "Disabled",
    Enabled: "Enabled",
};
const TransitionDefaultMinimumObjectSize = {
    all_storage_classes_128K: "all_storage_classes_128K",
    varies_by_storage_class: "varies_by_storage_class",
};
const BucketLogsPermission = {
    FULL_CONTROL: "FULL_CONTROL",
    READ: "READ",
    WRITE: "WRITE",
};
const PartitionDateSource = {
    DeliveryTime: "DeliveryTime",
    EventTime: "EventTime",
};
const S3TablesBucketType = {
    aws: "aws",
    customer: "customer",
};
const Event = {
    s3_IntelligentTiering: "s3:IntelligentTiering",
    s3_LifecycleExpiration_: "s3:LifecycleExpiration:*",
    s3_LifecycleExpiration_Delete: "s3:LifecycleExpiration:Delete",
    s3_LifecycleExpiration_DeleteMarkerCreated: "s3:LifecycleExpiration:DeleteMarkerCreated",
    s3_LifecycleTransition: "s3:LifecycleTransition",
    s3_ObjectAcl_Put: "s3:ObjectAcl:Put",
    s3_ObjectCreated_: "s3:ObjectCreated:*",
    s3_ObjectCreated_CompleteMultipartUpload: "s3:ObjectCreated:CompleteMultipartUpload",
    s3_ObjectCreated_Copy: "s3:ObjectCreated:Copy",
    s3_ObjectCreated_Post: "s3:ObjectCreated:Post",
    s3_ObjectCreated_Put: "s3:ObjectCreated:Put",
    s3_ObjectRemoved_: "s3:ObjectRemoved:*",
    s3_ObjectRemoved_Delete: "s3:ObjectRemoved:Delete",
    s3_ObjectRemoved_DeleteMarkerCreated: "s3:ObjectRemoved:DeleteMarkerCreated",
    s3_ObjectRestore_: "s3:ObjectRestore:*",
    s3_ObjectRestore_Completed: "s3:ObjectRestore:Completed",
    s3_ObjectRestore_Delete: "s3:ObjectRestore:Delete",
    s3_ObjectRestore_Post: "s3:ObjectRestore:Post",
    s3_ObjectTagging_: "s3:ObjectTagging:*",
    s3_ObjectTagging_Delete: "s3:ObjectTagging:Delete",
    s3_ObjectTagging_Put: "s3:ObjectTagging:Put",
    s3_ReducedRedundancyLostObject: "s3:ReducedRedundancyLostObject",
    s3_Replication_: "s3:Replication:*",
    s3_Replication_OperationFailedReplication: "s3:Replication:OperationFailedReplication",
    s3_Replication_OperationMissedThreshold: "s3:Replication:OperationMissedThreshold",
    s3_Replication_OperationNotTracked: "s3:Replication:OperationNotTracked",
    s3_Replication_OperationReplicatedAfterThreshold: "s3:Replication:OperationReplicatedAfterThreshold",
};
const FilterRuleName = {
    prefix: "prefix",
    suffix: "suffix",
};
const DeleteMarkerReplicationStatus = {
    Disabled: "Disabled",
    Enabled: "Enabled",
};
const MetricsStatus = {
    Disabled: "Disabled",
    Enabled: "Enabled",
};
const ReplicationTimeStatus = {
    Disabled: "Disabled",
    Enabled: "Enabled",
};
const ExistingObjectReplicationStatus = {
    Disabled: "Disabled",
    Enabled: "Enabled",
};
const ReplicaModificationsStatus = {
    Disabled: "Disabled",
    Enabled: "Enabled",
};
const SseKmsEncryptedObjectsStatus = {
    Disabled: "Disabled",
    Enabled: "Enabled",
};
const ReplicationRuleStatus = {
    Disabled: "Disabled",
    Enabled: "Enabled",
};
const Payer = {
    BucketOwner: "BucketOwner",
    Requester: "Requester",
};
const MFADeleteStatus = {
    Disabled: "Disabled",
    Enabled: "Enabled",
};
const BucketVersioningStatus = {
    Enabled: "Enabled",
    Suspended: "Suspended",
};
const Protocol = {
    http: "http",
    https: "https",
};
const ReplicationStatus = {
    COMPLETE: "COMPLETE",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    PENDING: "PENDING",
    REPLICA: "REPLICA",
};
const ChecksumMode = {
    ENABLED: "ENABLED",
};
const ObjectAttributes = {
    CHECKSUM: "Checksum",
    ETAG: "ETag",
    OBJECT_PARTS: "ObjectParts",
    OBJECT_SIZE: "ObjectSize",
    STORAGE_CLASS: "StorageClass",
};
const ObjectLockEnabled = {
    Enabled: "Enabled",
};
const ObjectLockRetentionMode = {
    COMPLIANCE: "COMPLIANCE",
    GOVERNANCE: "GOVERNANCE",
};
const ArchiveStatus = {
    ARCHIVE_ACCESS: "ARCHIVE_ACCESS",
    DEEP_ARCHIVE_ACCESS: "DEEP_ARCHIVE_ACCESS",
};
const EncodingType = {
    url: "url",
};
const ObjectStorageClass = {
    DEEP_ARCHIVE: "DEEP_ARCHIVE",
    EXPRESS_ONEZONE: "EXPRESS_ONEZONE",
    FSX_ONTAP: "FSX_ONTAP",
    FSX_OPENZFS: "FSX_OPENZFS",
    GLACIER: "GLACIER",
    GLACIER_IR: "GLACIER_IR",
    INTELLIGENT_TIERING: "INTELLIGENT_TIERING",
    ONEZONE_IA: "ONEZONE_IA",
    OUTPOSTS: "OUTPOSTS",
    REDUCED_REDUNDANCY: "REDUCED_REDUNDANCY",
    SNOW: "SNOW",
    STANDARD: "STANDARD",
    STANDARD_IA: "STANDARD_IA",
};
const OptionalObjectAttributes = {
    RESTORE_STATUS: "RestoreStatus",
};
const ObjectVersionStorageClass = {
    STANDARD: "STANDARD",
};
const MFADelete = {
    Disabled: "Disabled",
    Enabled: "Enabled",
};
const Tier = {
    Bulk: "Bulk",
    Expedited: "Expedited",
    Standard: "Standard",
};
const ExpressionType = {
    SQL: "SQL",
};
const CompressionType = {
    BZIP2: "BZIP2",
    GZIP: "GZIP",
    NONE: "NONE",
};
const FileHeaderInfo = {
    IGNORE: "IGNORE",
    NONE: "NONE",
    USE: "USE",
};
const JSONType = {
    DOCUMENT: "DOCUMENT",
    LINES: "LINES",
};
const QuoteFields = {
    ALWAYS: "ALWAYS",
    ASNEEDED: "ASNEEDED",
};
const RestoreRequestType = {
    SELECT: "SELECT",
};

exports.$Command = smithyClient.Command;
exports.__Client = smithyClient.Client;
exports.S3ServiceException = S3ServiceException.S3ServiceException;
exports.AbortMultipartUploadCommand = AbortMultipartUploadCommand;
exports.AnalyticsS3ExportFileFormat = AnalyticsS3ExportFileFormat;
exports.ArchiveStatus = ArchiveStatus;
exports.BucketAbacStatus = BucketAbacStatus;
exports.BucketAccelerateStatus = BucketAccelerateStatus;
exports.BucketCannedACL = BucketCannedACL;
exports.BucketLocationConstraint = BucketLocationConstraint;
exports.BucketLogsPermission = BucketLogsPermission;
exports.BucketType = BucketType;
exports.BucketVersioningStatus = BucketVersioningStatus;
exports.ChecksumAlgorithm = ChecksumAlgorithm;
exports.ChecksumMode = ChecksumMode;
exports.ChecksumType = ChecksumType;
exports.CompleteMultipartUploadCommand = CompleteMultipartUploadCommand;
exports.CompressionType = CompressionType;
exports.CopyObjectCommand = CopyObjectCommand;
exports.CreateBucketCommand = CreateBucketCommand;
exports.CreateBucketMetadataConfigurationCommand = CreateBucketMetadataConfigurationCommand;
exports.CreateBucketMetadataTableConfigurationCommand = CreateBucketMetadataTableConfigurationCommand;
exports.CreateMultipartUploadCommand = CreateMultipartUploadCommand;
exports.CreateSessionCommand = CreateSessionCommand;
exports.DataRedundancy = DataRedundancy;
exports.DeleteBucketAnalyticsConfigurationCommand = DeleteBucketAnalyticsConfigurationCommand;
exports.DeleteBucketCommand = DeleteBucketCommand;
exports.DeleteBucketCorsCommand = DeleteBucketCorsCommand;
exports.DeleteBucketEncryptionCommand = DeleteBucketEncryptionCommand;
exports.DeleteBucketIntelligentTieringConfigurationCommand = DeleteBucketIntelligentTieringConfigurationCommand;
exports.DeleteBucketInventoryConfigurationCommand = DeleteBucketInventoryConfigurationCommand;
exports.DeleteBucketLifecycleCommand = DeleteBucketLifecycleCommand;
exports.DeleteBucketMetadataConfigurationCommand = DeleteBucketMetadataConfigurationCommand;
exports.DeleteBucketMetadataTableConfigurationCommand = DeleteBucketMetadataTableConfigurationCommand;
exports.DeleteBucketMetricsConfigurationCommand = DeleteBucketMetricsConfigurationCommand;
exports.DeleteBucketOwnershipControlsCommand = DeleteBucketOwnershipControlsCommand;
exports.DeleteBucketPolicyCommand = DeleteBucketPolicyCommand;
exports.DeleteBucketReplicationCommand = DeleteBucketReplicationCommand;
exports.DeleteBucketTaggingCommand = DeleteBucketTaggingCommand;
exports.DeleteBucketWebsiteCommand = DeleteBucketWebsiteCommand;
exports.DeleteMarkerReplicationStatus = DeleteMarkerReplicationStatus;
exports.DeleteObjectCommand = DeleteObjectCommand;
exports.DeleteObjectTaggingCommand = DeleteObjectTaggingCommand;
exports.DeleteObjectsCommand = DeleteObjectsCommand;
exports.DeletePublicAccessBlockCommand = DeletePublicAccessBlockCommand;
exports.EncodingType = EncodingType;
exports.EncryptionType = EncryptionType;
exports.Event = Event;
exports.ExistingObjectReplicationStatus = ExistingObjectReplicationStatus;
exports.ExpirationState = ExpirationState;
exports.ExpirationStatus = ExpirationStatus;
exports.ExpressionType = ExpressionType;
exports.FileHeaderInfo = FileHeaderInfo;
exports.FilterRuleName = FilterRuleName;
exports.GetBucketAbacCommand = GetBucketAbacCommand;
exports.GetBucketAccelerateConfigurationCommand = GetBucketAccelerateConfigurationCommand;
exports.GetBucketAclCommand = GetBucketAclCommand;
exports.GetBucketAnalyticsConfigurationCommand = GetBucketAnalyticsConfigurationCommand;
exports.GetBucketCorsCommand = GetBucketCorsCommand;
exports.GetBucketEncryptionCommand = GetBucketEncryptionCommand;
exports.GetBucketIntelligentTieringConfigurationCommand = GetBucketIntelligentTieringConfigurationCommand;
exports.GetBucketInventoryConfigurationCommand = GetBucketInventoryConfigurationCommand;
exports.GetBucketLifecycleConfigurationCommand = GetBucketLifecycleConfigurationCommand;
exports.GetBucketLocationCommand = GetBucketLocationCommand;
exports.GetBucketLoggingCommand = GetBucketLoggingCommand;
exports.GetBucketMetadataConfigurationCommand = GetBucketMetadataConfigurationCommand;
exports.GetBucketMetadataTableConfigurationCommand = GetBucketMetadataTableConfigurationCommand;
exports.GetBucketMetricsConfigurationCommand = GetBucketMetricsConfigurationCommand;
exports.GetBucketNotificationConfigurationCommand = GetBucketNotificationConfigurationCommand;
exports.GetBucketOwnershipControlsCommand = GetBucketOwnershipControlsCommand;
exports.GetBucketPolicyCommand = GetBucketPolicyCommand;
exports.GetBucketPolicyStatusCommand = GetBucketPolicyStatusCommand;
exports.GetBucketReplicationCommand = GetBucketReplicationCommand;
exports.GetBucketRequestPaymentCommand = GetBucketRequestPaymentCommand;
exports.GetBucketTaggingCommand = GetBucketTaggingCommand;
exports.GetBucketVersioningCommand = GetBucketVersioningCommand;
exports.GetBucketWebsiteCommand = GetBucketWebsiteCommand;
exports.GetObjectAclCommand = GetObjectAclCommand;
exports.GetObjectAttributesCommand = GetObjectAttributesCommand;
exports.GetObjectCommand = GetObjectCommand;
exports.GetObjectLegalHoldCommand = GetObjectLegalHoldCommand;
exports.GetObjectLockConfigurationCommand = GetObjectLockConfigurationCommand;
exports.GetObjectRetentionCommand = GetObjectRetentionCommand;
exports.GetObjectTaggingCommand = GetObjectTaggingCommand;
exports.GetObjectTorrentCommand = GetObjectTorrentCommand;
exports.GetPublicAccessBlockCommand = GetPublicAccessBlockCommand;
exports.HeadBucketCommand = HeadBucketCommand;
exports.HeadObjectCommand = HeadObjectCommand;
exports.IntelligentTieringAccessTier = IntelligentTieringAccessTier;
exports.IntelligentTieringStatus = IntelligentTieringStatus;
exports.InventoryConfigurationState = InventoryConfigurationState;
exports.InventoryFormat = InventoryFormat;
exports.InventoryFrequency = InventoryFrequency;
exports.InventoryIncludedObjectVersions = InventoryIncludedObjectVersions;
exports.InventoryOptionalField = InventoryOptionalField;
exports.JSONType = JSONType;
exports.ListBucketAnalyticsConfigurationsCommand = ListBucketAnalyticsConfigurationsCommand;
exports.ListBucketIntelligentTieringConfigurationsCommand = ListBucketIntelligentTieringConfigurationsCommand;
exports.ListBucketInventoryConfigurationsCommand = ListBucketInventoryConfigurationsCommand;
exports.ListBucketMetricsConfigurationsCommand = ListBucketMetricsConfigurationsCommand;
exports.ListBucketsCommand = ListBucketsCommand;
exports.ListDirectoryBucketsCommand = ListDirectoryBucketsCommand;
exports.ListMultipartUploadsCommand = ListMultipartUploadsCommand;
exports.ListObjectVersionsCommand = ListObjectVersionsCommand;
exports.ListObjectsCommand = ListObjectsCommand;
exports.ListObjectsV2Command = ListObjectsV2Command;
exports.ListPartsCommand = ListPartsCommand;
exports.LocationType = LocationType;
exports.MFADelete = MFADelete;
exports.MFADeleteStatus = MFADeleteStatus;
exports.MetadataDirective = MetadataDirective;
exports.MetricsStatus = MetricsStatus;
exports.ObjectAttributes = ObjectAttributes;
exports.ObjectCannedACL = ObjectCannedACL;
exports.ObjectLockEnabled = ObjectLockEnabled;
exports.ObjectLockLegalHoldStatus = ObjectLockLegalHoldStatus;
exports.ObjectLockMode = ObjectLockMode;
exports.ObjectLockRetentionMode = ObjectLockRetentionMode;
exports.ObjectOwnership = ObjectOwnership;
exports.ObjectStorageClass = ObjectStorageClass;
exports.ObjectVersionStorageClass = ObjectVersionStorageClass;
exports.OptionalObjectAttributes = OptionalObjectAttributes;
exports.OwnerOverride = OwnerOverride;
exports.PartitionDateSource = PartitionDateSource;
exports.Payer = Payer;
exports.Permission = Permission;
exports.Protocol = Protocol;
exports.PutBucketAbacCommand = PutBucketAbacCommand;
exports.PutBucketAccelerateConfigurationCommand = PutBucketAccelerateConfigurationCommand;
exports.PutBucketAclCommand = PutBucketAclCommand;
exports.PutBucketAnalyticsConfigurationCommand = PutBucketAnalyticsConfigurationCommand;
exports.PutBucketCorsCommand = PutBucketCorsCommand;
exports.PutBucketEncryptionCommand = PutBucketEncryptionCommand;
exports.PutBucketIntelligentTieringConfigurationCommand = PutBucketIntelligentTieringConfigurationCommand;
exports.PutBucketInventoryConfigurationCommand = PutBucketInventoryConfigurationCommand;
exports.PutBucketLifecycleConfigurationCommand = PutBucketLifecycleConfigurationCommand;
exports.PutBucketLoggingCommand = PutBucketLoggingCommand;
exports.PutBucketMetricsConfigurationCommand = PutBucketMetricsConfigurationCommand;
exports.PutBucketNotificationConfigurationCommand = PutBucketNotificationConfigurationCommand;
exports.PutBucketOwnershipControlsCommand = PutBucketOwnershipControlsCommand;
exports.PutBucketPolicyCommand = PutBucketPolicyCommand;
exports.PutBucketReplicationCommand = PutBucketReplicationCommand;
exports.PutBucketRequestPaymentCommand = PutBucketRequestPaymentCommand;
exports.PutBucketTaggingCommand = PutBucketTaggingCommand;
exports.PutBucketVersioningCommand = PutBucketVersioningCommand;
exports.PutBucketWebsiteCommand = PutBucketWebsiteCommand;
exports.PutObjectAclCommand = PutObjectAclCommand;
exports.PutObjectCommand = PutObjectCommand;
exports.PutObjectLegalHoldCommand = PutObjectLegalHoldCommand;
exports.PutObjectLockConfigurationCommand = PutObjectLockConfigurationCommand;
exports.PutObjectRetentionCommand = PutObjectRetentionCommand;
exports.PutObjectTaggingCommand = PutObjectTaggingCommand;
exports.PutPublicAccessBlockCommand = PutPublicAccessBlockCommand;
exports.QuoteFields = QuoteFields;
exports.RenameObjectCommand = RenameObjectCommand;
exports.ReplicaModificationsStatus = ReplicaModificationsStatus;
exports.ReplicationRuleStatus = ReplicationRuleStatus;
exports.ReplicationStatus = ReplicationStatus;
exports.ReplicationTimeStatus = ReplicationTimeStatus;
exports.RequestCharged = RequestCharged;
exports.RequestPayer = RequestPayer;
exports.RestoreObjectCommand = RestoreObjectCommand;
exports.RestoreRequestType = RestoreRequestType;
exports.S3 = S3;
exports.S3Client = S3Client;
exports.S3TablesBucketType = S3TablesBucketType;
exports.SelectObjectContentCommand = SelectObjectContentCommand;
exports.ServerSideEncryption = ServerSideEncryption;
exports.SessionMode = SessionMode;
exports.SseKmsEncryptedObjectsStatus = SseKmsEncryptedObjectsStatus;
exports.StorageClass = StorageClass;
exports.StorageClassAnalysisSchemaVersion = StorageClassAnalysisSchemaVersion;
exports.TableSseAlgorithm = TableSseAlgorithm;
exports.TaggingDirective = TaggingDirective;
exports.Tier = Tier;
exports.TransitionDefaultMinimumObjectSize = TransitionDefaultMinimumObjectSize;
exports.TransitionStorageClass = TransitionStorageClass;
exports.Type = Type;
exports.UpdateBucketMetadataInventoryTableConfigurationCommand = UpdateBucketMetadataInventoryTableConfigurationCommand;
exports.UpdateBucketMetadataJournalTableConfigurationCommand = UpdateBucketMetadataJournalTableConfigurationCommand;
exports.UpdateObjectEncryptionCommand = UpdateObjectEncryptionCommand;
exports.UploadPartCommand = UploadPartCommand;
exports.UploadPartCopyCommand = UploadPartCopyCommand;
exports.WriteGetObjectResponseCommand = WriteGetObjectResponseCommand;
exports.paginateListBuckets = paginateListBuckets;
exports.paginateListDirectoryBuckets = paginateListDirectoryBuckets;
exports.paginateListObjectsV2 = paginateListObjectsV2;
exports.paginateListParts = paginateListParts;
exports.waitForBucketExists = waitForBucketExists;
exports.waitForBucketNotExists = waitForBucketNotExists;
exports.waitForObjectExists = waitForObjectExists;
exports.waitForObjectNotExists = waitForObjectNotExists;
exports.waitUntilBucketExists = waitUntilBucketExists;
exports.waitUntilBucketNotExists = waitUntilBucketNotExists;
exports.waitUntilObjectExists = waitUntilObjectExists;
exports.waitUntilObjectNotExists = waitUntilObjectNotExists;
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

/***/ 64534:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.S3ServiceException = exports.__ServiceException = void 0;
const smithy_client_1 = __webpack_require__(58015);
Object.defineProperty(exports, "__ServiceException", ({ enumerable: true, get: function () { return smithy_client_1.ServiceException; } }));
class S3ServiceException extends smithy_client_1.ServiceException {
    constructor(options) {
        super(options);
        Object.setPrototypeOf(this, S3ServiceException.prototype);
    }
}
exports.S3ServiceException = S3ServiceException;


/***/ }),

/***/ 65003:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ObjectAlreadyInActiveTierError = exports.IdempotencyParameterMismatch = exports.TooManyParts = exports.InvalidWriteOffset = exports.InvalidRequest = exports.EncryptionTypeMismatch = exports.NotFound = exports.NoSuchKey = exports.InvalidObjectState = exports.NoSuchBucket = exports.BucketAlreadyOwnedByYou = exports.BucketAlreadyExists = exports.ObjectNotInActiveTierError = exports.AccessDenied = exports.NoSuchUpload = void 0;
const S3ServiceException_1 = __webpack_require__(64534);
class NoSuchUpload extends S3ServiceException_1.S3ServiceException {
    name = "NoSuchUpload";
    $fault = "client";
    constructor(opts) {
        super({
            name: "NoSuchUpload",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, NoSuchUpload.prototype);
    }
}
exports.NoSuchUpload = NoSuchUpload;
class AccessDenied extends S3ServiceException_1.S3ServiceException {
    name = "AccessDenied";
    $fault = "client";
    constructor(opts) {
        super({
            name: "AccessDenied",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, AccessDenied.prototype);
    }
}
exports.AccessDenied = AccessDenied;
class ObjectNotInActiveTierError extends S3ServiceException_1.S3ServiceException {
    name = "ObjectNotInActiveTierError";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ObjectNotInActiveTierError",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ObjectNotInActiveTierError.prototype);
    }
}
exports.ObjectNotInActiveTierError = ObjectNotInActiveTierError;
class BucketAlreadyExists extends S3ServiceException_1.S3ServiceException {
    name = "BucketAlreadyExists";
    $fault = "client";
    constructor(opts) {
        super({
            name: "BucketAlreadyExists",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, BucketAlreadyExists.prototype);
    }
}
exports.BucketAlreadyExists = BucketAlreadyExists;
class BucketAlreadyOwnedByYou extends S3ServiceException_1.S3ServiceException {
    name = "BucketAlreadyOwnedByYou";
    $fault = "client";
    constructor(opts) {
        super({
            name: "BucketAlreadyOwnedByYou",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, BucketAlreadyOwnedByYou.prototype);
    }
}
exports.BucketAlreadyOwnedByYou = BucketAlreadyOwnedByYou;
class NoSuchBucket extends S3ServiceException_1.S3ServiceException {
    name = "NoSuchBucket";
    $fault = "client";
    constructor(opts) {
        super({
            name: "NoSuchBucket",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, NoSuchBucket.prototype);
    }
}
exports.NoSuchBucket = NoSuchBucket;
class InvalidObjectState extends S3ServiceException_1.S3ServiceException {
    name = "InvalidObjectState";
    $fault = "client";
    StorageClass;
    AccessTier;
    constructor(opts) {
        super({
            name: "InvalidObjectState",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InvalidObjectState.prototype);
        this.StorageClass = opts.StorageClass;
        this.AccessTier = opts.AccessTier;
    }
}
exports.InvalidObjectState = InvalidObjectState;
class NoSuchKey extends S3ServiceException_1.S3ServiceException {
    name = "NoSuchKey";
    $fault = "client";
    constructor(opts) {
        super({
            name: "NoSuchKey",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, NoSuchKey.prototype);
    }
}
exports.NoSuchKey = NoSuchKey;
class NotFound extends S3ServiceException_1.S3ServiceException {
    name = "NotFound";
    $fault = "client";
    constructor(opts) {
        super({
            name: "NotFound",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, NotFound.prototype);
    }
}
exports.NotFound = NotFound;
class EncryptionTypeMismatch extends S3ServiceException_1.S3ServiceException {
    name = "EncryptionTypeMismatch";
    $fault = "client";
    constructor(opts) {
        super({
            name: "EncryptionTypeMismatch",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, EncryptionTypeMismatch.prototype);
    }
}
exports.EncryptionTypeMismatch = EncryptionTypeMismatch;
class InvalidRequest extends S3ServiceException_1.S3ServiceException {
    name = "InvalidRequest";
    $fault = "client";
    constructor(opts) {
        super({
            name: "InvalidRequest",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InvalidRequest.prototype);
    }
}
exports.InvalidRequest = InvalidRequest;
class InvalidWriteOffset extends S3ServiceException_1.S3ServiceException {
    name = "InvalidWriteOffset";
    $fault = "client";
    constructor(opts) {
        super({
            name: "InvalidWriteOffset",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, InvalidWriteOffset.prototype);
    }
}
exports.InvalidWriteOffset = InvalidWriteOffset;
class TooManyParts extends S3ServiceException_1.S3ServiceException {
    name = "TooManyParts";
    $fault = "client";
    constructor(opts) {
        super({
            name: "TooManyParts",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, TooManyParts.prototype);
    }
}
exports.TooManyParts = TooManyParts;
class IdempotencyParameterMismatch extends S3ServiceException_1.S3ServiceException {
    name = "IdempotencyParameterMismatch";
    $fault = "client";
    constructor(opts) {
        super({
            name: "IdempotencyParameterMismatch",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, IdempotencyParameterMismatch.prototype);
    }
}
exports.IdempotencyParameterMismatch = IdempotencyParameterMismatch;
class ObjectAlreadyInActiveTierError extends S3ServiceException_1.S3ServiceException {
    name = "ObjectAlreadyInActiveTierError";
    $fault = "client";
    constructor(opts) {
        super({
            name: "ObjectAlreadyInActiveTierError",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ObjectAlreadyInActiveTierError.prototype);
    }
}
exports.ObjectAlreadyInActiveTierError = ObjectAlreadyInActiveTierError;


/***/ }),

/***/ 23581:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getRuntimeConfig = void 0;
const tslib_1 = __webpack_require__(94176);
const package_json_1 = tslib_1.__importDefault(__webpack_require__(85754));
const core_1 = __webpack_require__(39116);
const credential_provider_node_1 = __webpack_require__(97777);
const middleware_bucket_endpoint_1 = __webpack_require__(16466);
const middleware_flexible_checksums_1 = __webpack_require__(90008);
const middleware_sdk_s3_1 = __webpack_require__(68937);
const util_user_agent_node_1 = __webpack_require__(16388);
const config_resolver_1 = __webpack_require__(93768);
const eventstream_serde_node_1 = __webpack_require__(63246);
const hash_node_1 = __webpack_require__(51296);
const hash_stream_node_1 = __webpack_require__(78281);
const middleware_retry_1 = __webpack_require__(46318);
const node_config_provider_1 = __webpack_require__(71172);
const node_http_handler_1 = __webpack_require__(18771);
const smithy_client_1 = __webpack_require__(58015);
const util_body_length_node_1 = __webpack_require__(68194);
const util_defaults_mode_node_1 = __webpack_require__(17215);
const util_retry_1 = __webpack_require__(54506);
const runtimeConfig_shared_1 = __webpack_require__(55570);
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
        disableS3ExpressSessionAuth: config?.disableS3ExpressSessionAuth ?? (0, node_config_provider_1.loadConfig)(middleware_sdk_s3_1.NODE_DISABLE_S3_EXPRESS_SESSION_AUTH_OPTIONS, loaderConfig),
        eventStreamSerdeProvider: config?.eventStreamSerdeProvider ?? eventstream_serde_node_1.eventStreamSerdeProvider,
        maxAttempts: config?.maxAttempts ?? (0, node_config_provider_1.loadConfig)(middleware_retry_1.NODE_MAX_ATTEMPT_CONFIG_OPTIONS, config),
        md5: config?.md5 ?? hash_node_1.Hash.bind(null, "md5"),
        region: config?.region ?? (0, node_config_provider_1.loadConfig)(config_resolver_1.NODE_REGION_CONFIG_OPTIONS, { ...config_resolver_1.NODE_REGION_CONFIG_FILE_OPTIONS, ...loaderConfig }),
        requestChecksumCalculation: config?.requestChecksumCalculation ?? (0, node_config_provider_1.loadConfig)(middleware_flexible_checksums_1.NODE_REQUEST_CHECKSUM_CALCULATION_CONFIG_OPTIONS, loaderConfig),
        requestHandler: node_http_handler_1.NodeHttpHandler.create(config?.requestHandler ?? defaultConfigProvider),
        responseChecksumValidation: config?.responseChecksumValidation ?? (0, node_config_provider_1.loadConfig)(middleware_flexible_checksums_1.NODE_RESPONSE_CHECKSUM_VALIDATION_CONFIG_OPTIONS, loaderConfig),
        retryMode: config?.retryMode ??
            (0, node_config_provider_1.loadConfig)({
                ...middleware_retry_1.NODE_RETRY_MODE_CONFIG_OPTIONS,
                default: async () => (await defaultConfigProvider()).retryMode || util_retry_1.DEFAULT_RETRY_MODE,
            }, config),
        sha1: config?.sha1 ?? hash_node_1.Hash.bind(null, "sha1"),
        sha256: config?.sha256 ?? hash_node_1.Hash.bind(null, "sha256"),
        sigv4aSigningRegionSet: config?.sigv4aSigningRegionSet ?? (0, node_config_provider_1.loadConfig)(core_1.NODE_SIGV4A_CONFIG_OPTIONS, loaderConfig),
        streamCollector: config?.streamCollector ?? node_http_handler_1.streamCollector,
        streamHasher: config?.streamHasher ?? hash_stream_node_1.readableStreamHasher,
        useArnRegion: config?.useArnRegion ?? (0, node_config_provider_1.loadConfig)(middleware_bucket_endpoint_1.NODE_USE_ARN_REGION_CONFIG_OPTIONS, loaderConfig),
        useDualstackEndpoint: config?.useDualstackEndpoint ?? (0, node_config_provider_1.loadConfig)(config_resolver_1.NODE_USE_DUALSTACK_ENDPOINT_CONFIG_OPTIONS, loaderConfig),
        useFipsEndpoint: config?.useFipsEndpoint ?? (0, node_config_provider_1.loadConfig)(config_resolver_1.NODE_USE_FIPS_ENDPOINT_CONFIG_OPTIONS, loaderConfig),
        userAgentAppId: config?.userAgentAppId ?? (0, node_config_provider_1.loadConfig)(util_user_agent_node_1.NODE_APP_ID_CONFIG_OPTIONS, loaderConfig),
    };
};
exports.getRuntimeConfig = getRuntimeConfig;


/***/ }),

/***/ 55570:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getRuntimeConfig = void 0;
const core_1 = __webpack_require__(39116);
const protocols_1 = __webpack_require__(23628);
const signature_v4_multi_region_1 = __webpack_require__(96861);
const smithy_client_1 = __webpack_require__(58015);
const url_parser_1 = __webpack_require__(7834);
const util_base64_1 = __webpack_require__(77245);
const util_stream_1 = __webpack_require__(48392);
const util_utf8_1 = __webpack_require__(76005);
const httpAuthSchemeProvider_1 = __webpack_require__(10340);
const endpointResolver_1 = __webpack_require__(75898);
const schemas_0_1 = __webpack_require__(2335);
const getRuntimeConfig = (config) => {
    return {
        apiVersion: "2006-03-01",
        base64Decoder: config?.base64Decoder ?? util_base64_1.fromBase64,
        base64Encoder: config?.base64Encoder ?? util_base64_1.toBase64,
        disableHostPrefix: config?.disableHostPrefix ?? false,
        endpointProvider: config?.endpointProvider ?? endpointResolver_1.defaultEndpointResolver,
        extensions: config?.extensions ?? [],
        getAwsChunkedEncodingStream: config?.getAwsChunkedEncodingStream ?? util_stream_1.getAwsChunkedEncodingStream,
        httpAuthSchemeProvider: config?.httpAuthSchemeProvider ?? httpAuthSchemeProvider_1.defaultS3HttpAuthSchemeProvider,
        httpAuthSchemes: config?.httpAuthSchemes ?? [
            {
                schemeId: "aws.auth#sigv4",
                identityProvider: (ipc) => ipc.getIdentityProvider("aws.auth#sigv4"),
                signer: new core_1.AwsSdkSigV4Signer(),
            },
            {
                schemeId: "aws.auth#sigv4a",
                identityProvider: (ipc) => ipc.getIdentityProvider("aws.auth#sigv4a"),
                signer: new core_1.AwsSdkSigV4ASigner(),
            },
        ],
        logger: config?.logger ?? new smithy_client_1.NoOpLogger(),
        protocol: config?.protocol ?? protocols_1.AwsRestXmlProtocol,
        protocolSettings: config?.protocolSettings ?? {
            defaultNamespace: "com.amazonaws.s3",
            errorTypeRegistries: schemas_0_1.errorTypeRegistries,
            xmlNamespace: "http://s3.amazonaws.com/doc/2006-03-01/",
            version: "2006-03-01",
            serviceTarget: "AmazonS3",
        },
        sdkStreamMixin: config?.sdkStreamMixin ?? util_stream_1.sdkStreamMixin,
        serviceId: config?.serviceId ?? "S3",
        signerConstructor: config?.signerConstructor ?? signature_v4_multi_region_1.SignatureV4MultiRegion,
        signingEscapePath: config?.signingEscapePath ?? false,
        urlParser: config?.urlParser ?? url_parser_1.parseUrl,
        useArnRegion: config?.useArnRegion ?? undefined,
        utf8Decoder: config?.utf8Decoder ?? util_utf8_1.fromUtf8,
        utf8Encoder: config?.utf8Encoder ?? util_utf8_1.toUtf8,
    };
};
exports.getRuntimeConfig = getRuntimeConfig;


/***/ }),

/***/ 2335:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.CreateBucketMetadataTableConfigurationRequest$ = exports.CreateBucketMetadataConfigurationRequest$ = exports.CreateBucketConfiguration$ = exports.CORSRule$ = exports.CORSConfiguration$ = exports.CopyPartResult$ = exports.CopyObjectResult$ = exports.CopyObjectRequest$ = exports.CopyObjectOutput$ = exports.ContinuationEvent$ = exports.Condition$ = exports.CompleteMultipartUploadRequest$ = exports.CompleteMultipartUploadOutput$ = exports.CompletedPart$ = exports.CompletedMultipartUpload$ = exports.CommonPrefix$ = exports.Checksum$ = exports.BucketLoggingStatus$ = exports.BucketLifecycleConfiguration$ = exports.BucketInfo$ = exports.Bucket$ = exports.BlockedEncryptionTypes$ = exports.AnalyticsS3BucketDestination$ = exports.AnalyticsExportDestination$ = exports.AnalyticsConfiguration$ = exports.AnalyticsAndOperator$ = exports.AccessControlTranslation$ = exports.AccessControlPolicy$ = exports.AccelerateConfiguration$ = exports.AbortMultipartUploadRequest$ = exports.AbortMultipartUploadOutput$ = exports.AbortIncompleteMultipartUpload$ = exports.AbacStatus$ = exports.errorTypeRegistries = exports.TooManyParts$ = exports.ObjectNotInActiveTierError$ = exports.ObjectAlreadyInActiveTierError$ = exports.NotFound$ = exports.NoSuchUpload$ = exports.NoSuchKey$ = exports.NoSuchBucket$ = exports.InvalidWriteOffset$ = exports.InvalidRequest$ = exports.InvalidObjectState$ = exports.IdempotencyParameterMismatch$ = exports.EncryptionTypeMismatch$ = exports.BucketAlreadyOwnedByYou$ = exports.BucketAlreadyExists$ = exports.AccessDenied$ = exports.S3ServiceException$ = void 0;
exports.GetBucketAccelerateConfigurationRequest$ = exports.GetBucketAccelerateConfigurationOutput$ = exports.GetBucketAbacRequest$ = exports.GetBucketAbacOutput$ = exports.FilterRule$ = exports.ExistingObjectReplication$ = exports.EventBridgeConfiguration$ = exports.ErrorDocument$ = exports.ErrorDetails$ = exports._Error$ = exports.EndEvent$ = exports.EncryptionConfiguration$ = exports.Encryption$ = exports.DestinationResult$ = exports.Destination$ = exports.DeletePublicAccessBlockRequest$ = exports.DeleteObjectTaggingRequest$ = exports.DeleteObjectTaggingOutput$ = exports.DeleteObjectsRequest$ = exports.DeleteObjectsOutput$ = exports.DeleteObjectRequest$ = exports.DeleteObjectOutput$ = exports.DeleteMarkerReplication$ = exports.DeleteMarkerEntry$ = exports.DeletedObject$ = exports.DeleteBucketWebsiteRequest$ = exports.DeleteBucketTaggingRequest$ = exports.DeleteBucketRequest$ = exports.DeleteBucketReplicationRequest$ = exports.DeleteBucketPolicyRequest$ = exports.DeleteBucketOwnershipControlsRequest$ = exports.DeleteBucketMetricsConfigurationRequest$ = exports.DeleteBucketMetadataTableConfigurationRequest$ = exports.DeleteBucketMetadataConfigurationRequest$ = exports.DeleteBucketLifecycleRequest$ = exports.DeleteBucketInventoryConfigurationRequest$ = exports.DeleteBucketIntelligentTieringConfigurationRequest$ = exports.DeleteBucketEncryptionRequest$ = exports.DeleteBucketCorsRequest$ = exports.DeleteBucketAnalyticsConfigurationRequest$ = exports.Delete$ = exports.DefaultRetention$ = exports.CSVOutput$ = exports.CSVInput$ = exports.CreateSessionRequest$ = exports.CreateSessionOutput$ = exports.CreateMultipartUploadRequest$ = exports.CreateMultipartUploadOutput$ = exports.CreateBucketRequest$ = exports.CreateBucketOutput$ = void 0;
exports.GetObjectLegalHoldRequest$ = exports.GetObjectLegalHoldOutput$ = exports.GetObjectAttributesRequest$ = exports.GetObjectAttributesParts$ = exports.GetObjectAttributesOutput$ = exports.GetObjectAclRequest$ = exports.GetObjectAclOutput$ = exports.GetBucketWebsiteRequest$ = exports.GetBucketWebsiteOutput$ = exports.GetBucketVersioningRequest$ = exports.GetBucketVersioningOutput$ = exports.GetBucketTaggingRequest$ = exports.GetBucketTaggingOutput$ = exports.GetBucketRequestPaymentRequest$ = exports.GetBucketRequestPaymentOutput$ = exports.GetBucketReplicationRequest$ = exports.GetBucketReplicationOutput$ = exports.GetBucketPolicyStatusRequest$ = exports.GetBucketPolicyStatusOutput$ = exports.GetBucketPolicyRequest$ = exports.GetBucketPolicyOutput$ = exports.GetBucketOwnershipControlsRequest$ = exports.GetBucketOwnershipControlsOutput$ = exports.GetBucketNotificationConfigurationRequest$ = exports.GetBucketMetricsConfigurationRequest$ = exports.GetBucketMetricsConfigurationOutput$ = exports.GetBucketMetadataTableConfigurationResult$ = exports.GetBucketMetadataTableConfigurationRequest$ = exports.GetBucketMetadataTableConfigurationOutput$ = exports.GetBucketMetadataConfigurationResult$ = exports.GetBucketMetadataConfigurationRequest$ = exports.GetBucketMetadataConfigurationOutput$ = exports.GetBucketLoggingRequest$ = exports.GetBucketLoggingOutput$ = exports.GetBucketLocationRequest$ = exports.GetBucketLocationOutput$ = exports.GetBucketLifecycleConfigurationRequest$ = exports.GetBucketLifecycleConfigurationOutput$ = exports.GetBucketInventoryConfigurationRequest$ = exports.GetBucketInventoryConfigurationOutput$ = exports.GetBucketIntelligentTieringConfigurationRequest$ = exports.GetBucketIntelligentTieringConfigurationOutput$ = exports.GetBucketEncryptionRequest$ = exports.GetBucketEncryptionOutput$ = exports.GetBucketCorsRequest$ = exports.GetBucketCorsOutput$ = exports.GetBucketAnalyticsConfigurationRequest$ = exports.GetBucketAnalyticsConfigurationOutput$ = exports.GetBucketAclRequest$ = exports.GetBucketAclOutput$ = void 0;
exports.ListBucketInventoryConfigurationsRequest$ = exports.ListBucketInventoryConfigurationsOutput$ = exports.ListBucketIntelligentTieringConfigurationsRequest$ = exports.ListBucketIntelligentTieringConfigurationsOutput$ = exports.ListBucketAnalyticsConfigurationsRequest$ = exports.ListBucketAnalyticsConfigurationsOutput$ = exports.LifecycleRuleFilter$ = exports.LifecycleRuleAndOperator$ = exports.LifecycleRule$ = exports.LifecycleExpiration$ = exports.LambdaFunctionConfiguration$ = exports.JSONOutput$ = exports.JSONInput$ = exports.JournalTableConfigurationUpdates$ = exports.JournalTableConfigurationResult$ = exports.JournalTableConfiguration$ = exports.InventoryTableConfigurationUpdates$ = exports.InventoryTableConfigurationResult$ = exports.InventoryTableConfiguration$ = exports.InventorySchedule$ = exports.InventoryS3BucketDestination$ = exports.InventoryFilter$ = exports.InventoryEncryption$ = exports.InventoryDestination$ = exports.InventoryConfiguration$ = exports.IntelligentTieringFilter$ = exports.IntelligentTieringConfiguration$ = exports.IntelligentTieringAndOperator$ = exports.InputSerialization$ = exports.Initiator$ = exports.IndexDocument$ = exports.HeadObjectRequest$ = exports.HeadObjectOutput$ = exports.HeadBucketRequest$ = exports.HeadBucketOutput$ = exports.Grantee$ = exports.Grant$ = exports.GlacierJobParameters$ = exports.GetPublicAccessBlockRequest$ = exports.GetPublicAccessBlockOutput$ = exports.GetObjectTorrentRequest$ = exports.GetObjectTorrentOutput$ = exports.GetObjectTaggingRequest$ = exports.GetObjectTaggingOutput$ = exports.GetObjectRetentionRequest$ = exports.GetObjectRetentionOutput$ = exports.GetObjectRequest$ = exports.GetObjectOutput$ = exports.GetObjectLockConfigurationRequest$ = exports.GetObjectLockConfigurationOutput$ = void 0;
exports.Progress$ = exports.PolicyStatus$ = exports.PartitionedPrefix$ = exports.Part$ = exports.ParquetInput$ = exports.OwnershipControlsRule$ = exports.OwnershipControls$ = exports.Owner$ = exports.OutputSerialization$ = exports.OutputLocation$ = exports.ObjectVersion$ = exports.ObjectPart$ = exports.ObjectLockRule$ = exports.ObjectLockRetention$ = exports.ObjectLockLegalHold$ = exports.ObjectLockConfiguration$ = exports.ObjectIdentifier$ = exports._Object$ = exports.NotificationConfigurationFilter$ = exports.NotificationConfiguration$ = exports.NoncurrentVersionTransition$ = exports.NoncurrentVersionExpiration$ = exports.MultipartUpload$ = exports.MetricsConfiguration$ = exports.MetricsAndOperator$ = exports.Metrics$ = exports.MetadataTableEncryptionConfiguration$ = exports.MetadataTableConfigurationResult$ = exports.MetadataTableConfiguration$ = exports.MetadataEntry$ = exports.MetadataConfigurationResult$ = exports.MetadataConfiguration$ = exports.LoggingEnabled$ = exports.LocationInfo$ = exports.ListPartsRequest$ = exports.ListPartsOutput$ = exports.ListObjectVersionsRequest$ = exports.ListObjectVersionsOutput$ = exports.ListObjectsV2Request$ = exports.ListObjectsV2Output$ = exports.ListObjectsRequest$ = exports.ListObjectsOutput$ = exports.ListMultipartUploadsRequest$ = exports.ListMultipartUploadsOutput$ = exports.ListDirectoryBucketsRequest$ = exports.ListDirectoryBucketsOutput$ = exports.ListBucketsRequest$ = exports.ListBucketsOutput$ = exports.ListBucketMetricsConfigurationsRequest$ = exports.ListBucketMetricsConfigurationsOutput$ = void 0;
exports.RequestPaymentConfiguration$ = exports.ReplicationTimeValue$ = exports.ReplicationTime$ = exports.ReplicationRuleFilter$ = exports.ReplicationRuleAndOperator$ = exports.ReplicationRule$ = exports.ReplicationConfiguration$ = exports.ReplicaModifications$ = exports.RenameObjectRequest$ = exports.RenameObjectOutput$ = exports.RedirectAllRequestsTo$ = exports.Redirect$ = exports.RecordsEvent$ = exports.RecordExpiration$ = exports.QueueConfiguration$ = exports.PutPublicAccessBlockRequest$ = exports.PutObjectTaggingRequest$ = exports.PutObjectTaggingOutput$ = exports.PutObjectRetentionRequest$ = exports.PutObjectRetentionOutput$ = exports.PutObjectRequest$ = exports.PutObjectOutput$ = exports.PutObjectLockConfigurationRequest$ = exports.PutObjectLockConfigurationOutput$ = exports.PutObjectLegalHoldRequest$ = exports.PutObjectLegalHoldOutput$ = exports.PutObjectAclRequest$ = exports.PutObjectAclOutput$ = exports.PutBucketWebsiteRequest$ = exports.PutBucketVersioningRequest$ = exports.PutBucketTaggingRequest$ = exports.PutBucketRequestPaymentRequest$ = exports.PutBucketReplicationRequest$ = exports.PutBucketPolicyRequest$ = exports.PutBucketOwnershipControlsRequest$ = exports.PutBucketNotificationConfigurationRequest$ = exports.PutBucketMetricsConfigurationRequest$ = exports.PutBucketLoggingRequest$ = exports.PutBucketLifecycleConfigurationRequest$ = exports.PutBucketLifecycleConfigurationOutput$ = exports.PutBucketInventoryConfigurationRequest$ = exports.PutBucketIntelligentTieringConfigurationRequest$ = exports.PutBucketEncryptionRequest$ = exports.PutBucketCorsRequest$ = exports.PutBucketAnalyticsConfigurationRequest$ = exports.PutBucketAclRequest$ = exports.PutBucketAccelerateConfigurationRequest$ = exports.PutBucketAbacRequest$ = exports.PublicAccessBlockConfiguration$ = exports.ProgressEvent$ = void 0;
exports.SelectObjectContentEventStream$ = exports.ObjectEncryption$ = exports.MetricsFilter$ = exports.AnalyticsFilter$ = exports.WriteGetObjectResponseRequest$ = exports.WebsiteConfiguration$ = exports.VersioningConfiguration$ = exports.UploadPartRequest$ = exports.UploadPartOutput$ = exports.UploadPartCopyRequest$ = exports.UploadPartCopyOutput$ = exports.UpdateObjectEncryptionResponse$ = exports.UpdateObjectEncryptionRequest$ = exports.UpdateBucketMetadataJournalTableConfigurationRequest$ = exports.UpdateBucketMetadataInventoryTableConfigurationRequest$ = exports.Transition$ = exports.TopicConfiguration$ = exports.Tiering$ = exports.TargetObjectKeyFormat$ = exports.TargetGrant$ = exports.Tagging$ = exports.Tag$ = exports.StorageClassAnalysisDataExport$ = exports.StorageClassAnalysis$ = exports.StatsEvent$ = exports.Stats$ = exports.SSES3$ = exports.SSEKMSEncryption$ = exports.SseKmsEncryptedObjects$ = exports.SSEKMS$ = exports.SourceSelectionCriteria$ = exports.SimplePrefix$ = exports.SessionCredentials$ = exports.ServerSideEncryptionRule$ = exports.ServerSideEncryptionConfiguration$ = exports.ServerSideEncryptionByDefault$ = exports.SelectParameters$ = exports.SelectObjectContentRequest$ = exports.SelectObjectContentOutput$ = exports.ScanRange$ = exports.S3TablesDestinationResult$ = exports.S3TablesDestination$ = exports.S3Location$ = exports.S3KeyFilter$ = exports.RoutingRule$ = exports.RestoreStatus$ = exports.RestoreRequest$ = exports.RestoreObjectRequest$ = exports.RestoreObjectOutput$ = exports.RequestProgress$ = void 0;
exports.GetBucketWebsite$ = exports.GetBucketVersioning$ = exports.GetBucketTagging$ = exports.GetBucketRequestPayment$ = exports.GetBucketReplication$ = exports.GetBucketPolicyStatus$ = exports.GetBucketPolicy$ = exports.GetBucketOwnershipControls$ = exports.GetBucketNotificationConfiguration$ = exports.GetBucketMetricsConfiguration$ = exports.GetBucketMetadataTableConfiguration$ = exports.GetBucketMetadataConfiguration$ = exports.GetBucketLogging$ = exports.GetBucketLocation$ = exports.GetBucketLifecycleConfiguration$ = exports.GetBucketInventoryConfiguration$ = exports.GetBucketIntelligentTieringConfiguration$ = exports.GetBucketEncryption$ = exports.GetBucketCors$ = exports.GetBucketAnalyticsConfiguration$ = exports.GetBucketAcl$ = exports.GetBucketAccelerateConfiguration$ = exports.GetBucketAbac$ = exports.DeletePublicAccessBlock$ = exports.DeleteObjectTagging$ = exports.DeleteObjects$ = exports.DeleteObject$ = exports.DeleteBucketWebsite$ = exports.DeleteBucketTagging$ = exports.DeleteBucketReplication$ = exports.DeleteBucketPolicy$ = exports.DeleteBucketOwnershipControls$ = exports.DeleteBucketMetricsConfiguration$ = exports.DeleteBucketMetadataTableConfiguration$ = exports.DeleteBucketMetadataConfiguration$ = exports.DeleteBucketLifecycle$ = exports.DeleteBucketInventoryConfiguration$ = exports.DeleteBucketIntelligentTieringConfiguration$ = exports.DeleteBucketEncryption$ = exports.DeleteBucketCors$ = exports.DeleteBucketAnalyticsConfiguration$ = exports.DeleteBucket$ = exports.CreateSession$ = exports.CreateMultipartUpload$ = exports.CreateBucketMetadataTableConfiguration$ = exports.CreateBucketMetadataConfiguration$ = exports.CreateBucket$ = exports.CopyObject$ = exports.CompleteMultipartUpload$ = exports.AbortMultipartUpload$ = void 0;
exports.RestoreObject$ = exports.RenameObject$ = exports.PutPublicAccessBlock$ = exports.PutObjectTagging$ = exports.PutObjectRetention$ = exports.PutObjectLockConfiguration$ = exports.PutObjectLegalHold$ = exports.PutObjectAcl$ = exports.PutObject$ = exports.PutBucketWebsite$ = exports.PutBucketVersioning$ = exports.PutBucketTagging$ = exports.PutBucketRequestPayment$ = exports.PutBucketReplication$ = exports.PutBucketPolicy$ = exports.PutBucketOwnershipControls$ = exports.PutBucketNotificationConfiguration$ = exports.PutBucketMetricsConfiguration$ = exports.PutBucketLogging$ = exports.PutBucketLifecycleConfiguration$ = exports.PutBucketInventoryConfiguration$ = exports.PutBucketIntelligentTieringConfiguration$ = exports.PutBucketEncryption$ = exports.PutBucketCors$ = exports.PutBucketAnalyticsConfiguration$ = exports.PutBucketAcl$ = exports.PutBucketAccelerateConfiguration$ = exports.PutBucketAbac$ = exports.ListParts$ = exports.ListObjectVersions$ = exports.ListObjectsV2$ = exports.ListObjects$ = exports.ListMultipartUploads$ = exports.ListDirectoryBuckets$ = exports.ListBuckets$ = exports.ListBucketMetricsConfigurations$ = exports.ListBucketInventoryConfigurations$ = exports.ListBucketIntelligentTieringConfigurations$ = exports.ListBucketAnalyticsConfigurations$ = exports.HeadObject$ = exports.HeadBucket$ = exports.GetPublicAccessBlock$ = exports.GetObjectTorrent$ = exports.GetObjectTagging$ = exports.GetObjectRetention$ = exports.GetObjectLockConfiguration$ = exports.GetObjectLegalHold$ = exports.GetObjectAttributes$ = exports.GetObjectAcl$ = exports.GetObject$ = void 0;
exports.WriteGetObjectResponse$ = exports.UploadPartCopy$ = exports.UploadPart$ = exports.UpdateObjectEncryption$ = exports.UpdateBucketMetadataJournalTableConfiguration$ = exports.UpdateBucketMetadataInventoryTableConfiguration$ = exports.SelectObjectContent$ = void 0;
const _A = "Account";
const _AAO = "AnalyticsAndOperator";
const _AC = "AccelerateConfiguration";
const _ACL = "AccessControlList";
const _ACL_ = "ACL";
const _ACLn = "AnalyticsConfigurationList";
const _ACP = "AccessControlPolicy";
const _ACT = "AccessControlTranslation";
const _ACn = "AnalyticsConfiguration";
const _AD = "AccessDenied";
const _ADb = "AbortDate";
const _AED = "AnalyticsExportDestination";
const _AF = "AnalyticsFilter";
const _AH = "AllowedHeaders";
const _AHl = "AllowedHeader";
const _AI = "AccountId";
const _AIMU = "AbortIncompleteMultipartUpload";
const _AKI = "AccessKeyId";
const _AM = "AllowedMethods";
const _AMU = "AbortMultipartUpload";
const _AMUO = "AbortMultipartUploadOutput";
const _AMUR = "AbortMultipartUploadRequest";
const _AMl = "AllowedMethod";
const _AO = "AllowedOrigins";
const _AOl = "AllowedOrigin";
const _APA = "AccessPointAlias";
const _APAc = "AccessPointArn";
const _AQRD = "AllowQuotedRecordDelimiter";
const _AR = "AcceptRanges";
const _ARI = "AbortRuleId";
const _AS = "AbacStatus";
const _ASBD = "AnalyticsS3BucketDestination";
const _ASSEBD = "ApplyServerSideEncryptionByDefault";
const _ASr = "ArchiveStatus";
const _AT = "AccessTier";
const _An = "And";
const _B = "Bucket";
const _BA = "BucketArn";
const _BAE = "BucketAlreadyExists";
const _BAI = "BucketAccountId";
const _BAOBY = "BucketAlreadyOwnedByYou";
const _BET = "BlockedEncryptionTypes";
const _BGR = "BypassGovernanceRetention";
const _BI = "BucketInfo";
const _BKE = "BucketKeyEnabled";
const _BLC = "BucketLifecycleConfiguration";
const _BLN = "BucketLocationName";
const _BLS = "BucketLoggingStatus";
const _BLT = "BucketLocationType";
const _BN = "BucketName";
const _BP = "BytesProcessed";
const _BPA = "BlockPublicAcls";
const _BPP = "BlockPublicPolicy";
const _BR = "BucketRegion";
const _BRy = "BytesReturned";
const _BS = "BytesScanned";
const _Bo = "Body";
const _Bu = "Buckets";
const _C = "Checksum";
const _CA = "ChecksumAlgorithm";
const _CACL = "CannedACL";
const _CB = "CreateBucket";
const _CBC = "CreateBucketConfiguration";
const _CBMC = "CreateBucketMetadataConfiguration";
const _CBMCR = "CreateBucketMetadataConfigurationRequest";
const _CBMTC = "CreateBucketMetadataTableConfiguration";
const _CBMTCR = "CreateBucketMetadataTableConfigurationRequest";
const _CBO = "CreateBucketOutput";
const _CBR = "CreateBucketRequest";
const _CC = "CacheControl";
const _CCRC = "ChecksumCRC32";
const _CCRCC = "ChecksumCRC32C";
const _CCRCNVME = "ChecksumCRC64NVME";
const _CC_ = "Cache-Control";
const _CD = "CreationDate";
const _CD_ = "Content-Disposition";
const _CDo = "ContentDisposition";
const _CE = "ContinuationEvent";
const _CE_ = "Content-Encoding";
const _CEo = "ContentEncoding";
const _CF = "CloudFunction";
const _CFC = "CloudFunctionConfiguration";
const _CL = "ContentLanguage";
const _CL_ = "Content-Language";
const _CL__ = "Content-Length";
const _CLo = "ContentLength";
const _CM = "Content-MD5";
const _CMD = "ContentMD5";
const _CMU = "CompletedMultipartUpload";
const _CMUO = "CompleteMultipartUploadOutput";
const _CMUOr = "CreateMultipartUploadOutput";
const _CMUR = "CompleteMultipartUploadResult";
const _CMURo = "CompleteMultipartUploadRequest";
const _CMURr = "CreateMultipartUploadRequest";
const _CMUo = "CompleteMultipartUpload";
const _CMUr = "CreateMultipartUpload";
const _CMh = "ChecksumMode";
const _CO = "CopyObject";
const _COO = "CopyObjectOutput";
const _COR = "CopyObjectResult";
const _CORSC = "CORSConfiguration";
const _CORSR = "CORSRules";
const _CORSRu = "CORSRule";
const _CORo = "CopyObjectRequest";
const _CP = "CommonPrefix";
const _CPL = "CommonPrefixList";
const _CPLo = "CompletedPartList";
const _CPR = "CopyPartResult";
const _CPo = "CompletedPart";
const _CPom = "CommonPrefixes";
const _CR = "ContentRange";
const _CRSBA = "ConfirmRemoveSelfBucketAccess";
const _CR_ = "Content-Range";
const _CS = "CopySource";
const _CSHA = "ChecksumSHA1";
const _CSHAh = "ChecksumSHA256";
const _CSIM = "CopySourceIfMatch";
const _CSIMS = "CopySourceIfModifiedSince";
const _CSINM = "CopySourceIfNoneMatch";
const _CSIUS = "CopySourceIfUnmodifiedSince";
const _CSO = "CreateSessionOutput";
const _CSR = "CreateSessionResult";
const _CSRo = "CopySourceRange";
const _CSRr = "CreateSessionRequest";
const _CSSSECA = "CopySourceSSECustomerAlgorithm";
const _CSSSECK = "CopySourceSSECustomerKey";
const _CSSSECKMD = "CopySourceSSECustomerKeyMD5";
const _CSV = "CSV";
const _CSVI = "CopySourceVersionId";
const _CSVIn = "CSVInput";
const _CSVO = "CSVOutput";
const _CSo = "ConfigurationState";
const _CSr = "CreateSession";
const _CT = "ChecksumType";
const _CT_ = "Content-Type";
const _CTl = "ClientToken";
const _CTo = "ContentType";
const _CTom = "CompressionType";
const _CTon = "ContinuationToken";
const _Co = "Condition";
const _Cod = "Code";
const _Com = "Comments";
const _Con = "Contents";
const _Cont = "Cont";
const _Cr = "Credentials";
const _D = "Days";
const _DAI = "DaysAfterInitiation";
const _DB = "DeleteBucket";
const _DBAC = "DeleteBucketAnalyticsConfiguration";
const _DBACR = "DeleteBucketAnalyticsConfigurationRequest";
const _DBC = "DeleteBucketCors";
const _DBCR = "DeleteBucketCorsRequest";
const _DBE = "DeleteBucketEncryption";
const _DBER = "DeleteBucketEncryptionRequest";
const _DBIC = "DeleteBucketInventoryConfiguration";
const _DBICR = "DeleteBucketInventoryConfigurationRequest";
const _DBITC = "DeleteBucketIntelligentTieringConfiguration";
const _DBITCR = "DeleteBucketIntelligentTieringConfigurationRequest";
const _DBL = "DeleteBucketLifecycle";
const _DBLR = "DeleteBucketLifecycleRequest";
const _DBMC = "DeleteBucketMetadataConfiguration";
const _DBMCR = "DeleteBucketMetadataConfigurationRequest";
const _DBMCRe = "DeleteBucketMetricsConfigurationRequest";
const _DBMCe = "DeleteBucketMetricsConfiguration";
const _DBMTC = "DeleteBucketMetadataTableConfiguration";
const _DBMTCR = "DeleteBucketMetadataTableConfigurationRequest";
const _DBOC = "DeleteBucketOwnershipControls";
const _DBOCR = "DeleteBucketOwnershipControlsRequest";
const _DBP = "DeleteBucketPolicy";
const _DBPR = "DeleteBucketPolicyRequest";
const _DBR = "DeleteBucketRequest";
const _DBRR = "DeleteBucketReplicationRequest";
const _DBRe = "DeleteBucketReplication";
const _DBT = "DeleteBucketTagging";
const _DBTR = "DeleteBucketTaggingRequest";
const _DBW = "DeleteBucketWebsite";
const _DBWR = "DeleteBucketWebsiteRequest";
const _DE = "DataExport";
const _DIM = "DestinationIfMatch";
const _DIMS = "DestinationIfModifiedSince";
const _DINM = "DestinationIfNoneMatch";
const _DIUS = "DestinationIfUnmodifiedSince";
const _DM = "DeleteMarker";
const _DME = "DeleteMarkerEntry";
const _DMR = "DeleteMarkerReplication";
const _DMVI = "DeleteMarkerVersionId";
const _DMe = "DeleteMarkers";
const _DN = "DisplayName";
const _DO = "DeletedObject";
const _DOO = "DeleteObjectOutput";
const _DOOe = "DeleteObjectsOutput";
const _DOR = "DeleteObjectRequest";
const _DORe = "DeleteObjectsRequest";
const _DOT = "DeleteObjectTagging";
const _DOTO = "DeleteObjectTaggingOutput";
const _DOTR = "DeleteObjectTaggingRequest";
const _DOe = "DeletedObjects";
const _DOel = "DeleteObject";
const _DOele = "DeleteObjects";
const _DPAB = "DeletePublicAccessBlock";
const _DPABR = "DeletePublicAccessBlockRequest";
const _DR = "DataRedundancy";
const _DRe = "DefaultRetention";
const _DRel = "DeleteResult";
const _DRes = "DestinationResult";
const _Da = "Date";
const _De = "Delete";
const _Del = "Deleted";
const _Deli = "Delimiter";
const _Des = "Destination";
const _Desc = "Description";
const _Det = "Details";
const _E = "Expiration";
const _EA = "EmailAddress";
const _EBC = "EventBridgeConfiguration";
const _EBO = "ExpectedBucketOwner";
const _EC = "EncryptionConfiguration";
const _ECr = "ErrorCode";
const _ED = "ErrorDetails";
const _EDr = "ErrorDocument";
const _EE = "EndEvent";
const _EH = "ExposeHeaders";
const _EHx = "ExposeHeader";
const _EM = "ErrorMessage";
const _EODM = "ExpiredObjectDeleteMarker";
const _EOR = "ExistingObjectReplication";
const _ES = "ExpiresString";
const _ESBO = "ExpectedSourceBucketOwner";
const _ET = "EncryptionType";
const _ETL = "EncryptionTypeList";
const _ETM = "EncryptionTypeMismatch";
const _ETa = "ETag";
const _ETn = "EncodingType";
const _ETv = "EventThreshold";
const _ETx = "ExpressionType";
const _En = "Encryption";
const _Ena = "Enabled";
const _End = "End";
const _Er = "Errors";
const _Err = "Error";
const _Ev = "Events";
const _Eve = "Event";
const _Ex = "Expires";
const _Exp = "Expression";
const _F = "Filter";
const _FD = "FieldDelimiter";
const _FHI = "FileHeaderInfo";
const _FO = "FetchOwner";
const _FR = "FilterRule";
const _FRL = "FilterRuleList";
const _FRi = "FilterRules";
const _Fi = "Field";
const _Fo = "Format";
const _Fr = "Frequency";
const _G = "Grants";
const _GBA = "GetBucketAbac";
const _GBAC = "GetBucketAccelerateConfiguration";
const _GBACO = "GetBucketAccelerateConfigurationOutput";
const _GBACOe = "GetBucketAnalyticsConfigurationOutput";
const _GBACR = "GetBucketAccelerateConfigurationRequest";
const _GBACRe = "GetBucketAnalyticsConfigurationRequest";
const _GBACe = "GetBucketAnalyticsConfiguration";
const _GBAO = "GetBucketAbacOutput";
const _GBAOe = "GetBucketAclOutput";
const _GBAR = "GetBucketAbacRequest";
const _GBARe = "GetBucketAclRequest";
const _GBAe = "GetBucketAcl";
const _GBC = "GetBucketCors";
const _GBCO = "GetBucketCorsOutput";
const _GBCR = "GetBucketCorsRequest";
const _GBE = "GetBucketEncryption";
const _GBEO = "GetBucketEncryptionOutput";
const _GBER = "GetBucketEncryptionRequest";
const _GBIC = "GetBucketInventoryConfiguration";
const _GBICO = "GetBucketInventoryConfigurationOutput";
const _GBICR = "GetBucketInventoryConfigurationRequest";
const _GBITC = "GetBucketIntelligentTieringConfiguration";
const _GBITCO = "GetBucketIntelligentTieringConfigurationOutput";
const _GBITCR = "GetBucketIntelligentTieringConfigurationRequest";
const _GBL = "GetBucketLocation";
const _GBLC = "GetBucketLifecycleConfiguration";
const _GBLCO = "GetBucketLifecycleConfigurationOutput";
const _GBLCR = "GetBucketLifecycleConfigurationRequest";
const _GBLO = "GetBucketLocationOutput";
const _GBLOe = "GetBucketLoggingOutput";
const _GBLR = "GetBucketLocationRequest";
const _GBLRe = "GetBucketLoggingRequest";
const _GBLe = "GetBucketLogging";
const _GBMC = "GetBucketMetadataConfiguration";
const _GBMCO = "GetBucketMetadataConfigurationOutput";
const _GBMCOe = "GetBucketMetricsConfigurationOutput";
const _GBMCR = "GetBucketMetadataConfigurationResult";
const _GBMCRe = "GetBucketMetadataConfigurationRequest";
const _GBMCRet = "GetBucketMetricsConfigurationRequest";
const _GBMCe = "GetBucketMetricsConfiguration";
const _GBMTC = "GetBucketMetadataTableConfiguration";
const _GBMTCO = "GetBucketMetadataTableConfigurationOutput";
const _GBMTCR = "GetBucketMetadataTableConfigurationResult";
const _GBMTCRe = "GetBucketMetadataTableConfigurationRequest";
const _GBNC = "GetBucketNotificationConfiguration";
const _GBNCR = "GetBucketNotificationConfigurationRequest";
const _GBOC = "GetBucketOwnershipControls";
const _GBOCO = "GetBucketOwnershipControlsOutput";
const _GBOCR = "GetBucketOwnershipControlsRequest";
const _GBP = "GetBucketPolicy";
const _GBPO = "GetBucketPolicyOutput";
const _GBPR = "GetBucketPolicyRequest";
const _GBPS = "GetBucketPolicyStatus";
const _GBPSO = "GetBucketPolicyStatusOutput";
const _GBPSR = "GetBucketPolicyStatusRequest";
const _GBR = "GetBucketReplication";
const _GBRO = "GetBucketReplicationOutput";
const _GBRP = "GetBucketRequestPayment";
const _GBRPO = "GetBucketRequestPaymentOutput";
const _GBRPR = "GetBucketRequestPaymentRequest";
const _GBRR = "GetBucketReplicationRequest";
const _GBT = "GetBucketTagging";
const _GBTO = "GetBucketTaggingOutput";
const _GBTR = "GetBucketTaggingRequest";
const _GBV = "GetBucketVersioning";
const _GBVO = "GetBucketVersioningOutput";
const _GBVR = "GetBucketVersioningRequest";
const _GBW = "GetBucketWebsite";
const _GBWO = "GetBucketWebsiteOutput";
const _GBWR = "GetBucketWebsiteRequest";
const _GFC = "GrantFullControl";
const _GJP = "GlacierJobParameters";
const _GO = "GetObject";
const _GOA = "GetObjectAcl";
const _GOAO = "GetObjectAclOutput";
const _GOAOe = "GetObjectAttributesOutput";
const _GOAP = "GetObjectAttributesParts";
const _GOAR = "GetObjectAclRequest";
const _GOARe = "GetObjectAttributesResponse";
const _GOARet = "GetObjectAttributesRequest";
const _GOAe = "GetObjectAttributes";
const _GOLC = "GetObjectLockConfiguration";
const _GOLCO = "GetObjectLockConfigurationOutput";
const _GOLCR = "GetObjectLockConfigurationRequest";
const _GOLH = "GetObjectLegalHold";
const _GOLHO = "GetObjectLegalHoldOutput";
const _GOLHR = "GetObjectLegalHoldRequest";
const _GOO = "GetObjectOutput";
const _GOR = "GetObjectRequest";
const _GORO = "GetObjectRetentionOutput";
const _GORR = "GetObjectRetentionRequest";
const _GORe = "GetObjectRetention";
const _GOT = "GetObjectTagging";
const _GOTO = "GetObjectTaggingOutput";
const _GOTOe = "GetObjectTorrentOutput";
const _GOTR = "GetObjectTaggingRequest";
const _GOTRe = "GetObjectTorrentRequest";
const _GOTe = "GetObjectTorrent";
const _GPAB = "GetPublicAccessBlock";
const _GPABO = "GetPublicAccessBlockOutput";
const _GPABR = "GetPublicAccessBlockRequest";
const _GR = "GrantRead";
const _GRACP = "GrantReadACP";
const _GW = "GrantWrite";
const _GWACP = "GrantWriteACP";
const _Gr = "Grant";
const _Gra = "Grantee";
const _HB = "HeadBucket";
const _HBO = "HeadBucketOutput";
const _HBR = "HeadBucketRequest";
const _HECRE = "HttpErrorCodeReturnedEquals";
const _HN = "HostName";
const _HO = "HeadObject";
const _HOO = "HeadObjectOutput";
const _HOR = "HeadObjectRequest";
const _HRC = "HttpRedirectCode";
const _I = "Id";
const _IC = "InventoryConfiguration";
const _ICL = "InventoryConfigurationList";
const _ID = "ID";
const _IDn = "IndexDocument";
const _IDnv = "InventoryDestination";
const _IE = "IsEnabled";
const _IEn = "InventoryEncryption";
const _IF = "InventoryFilter";
const _IL = "IsLatest";
const _IM = "IfMatch";
const _IMIT = "IfMatchInitiatedTime";
const _IMLMT = "IfMatchLastModifiedTime";
const _IMS = "IfMatchSize";
const _IMS_ = "If-Modified-Since";
const _IMSf = "IfModifiedSince";
const _IMUR = "InitiateMultipartUploadResult";
const _IM_ = "If-Match";
const _INM = "IfNoneMatch";
const _INM_ = "If-None-Match";
const _IOF = "InventoryOptionalFields";
const _IOS = "InvalidObjectState";
const _IOV = "IncludedObjectVersions";
const _IP = "IsPublic";
const _IPA = "IgnorePublicAcls";
const _IPM = "IdempotencyParameterMismatch";
const _IR = "InvalidRequest";
const _IRIP = "IsRestoreInProgress";
const _IS = "InputSerialization";
const _ISBD = "InventoryS3BucketDestination";
const _ISn = "InventorySchedule";
const _IT = "IsTruncated";
const _ITAO = "IntelligentTieringAndOperator";
const _ITC = "IntelligentTieringConfiguration";
const _ITCL = "IntelligentTieringConfigurationList";
const _ITCR = "InventoryTableConfigurationResult";
const _ITCU = "InventoryTableConfigurationUpdates";
const _ITCn = "InventoryTableConfiguration";
const _ITF = "IntelligentTieringFilter";
const _IUS = "IfUnmodifiedSince";
const _IUS_ = "If-Unmodified-Since";
const _IWO = "InvalidWriteOffset";
const _In = "Initiator";
const _Ini = "Initiated";
const _JSON = "JSON";
const _JSONI = "JSONInput";
const _JSONO = "JSONOutput";
const _JTC = "JournalTableConfiguration";
const _JTCR = "JournalTableConfigurationResult";
const _JTCU = "JournalTableConfigurationUpdates";
const _K = "Key";
const _KC = "KeyCount";
const _KI = "KeyId";
const _KKA = "KmsKeyArn";
const _KM = "KeyMarker";
const _KMSC = "KMSContext";
const _KMSKA = "KMSKeyArn";
const _KMSKI = "KMSKeyId";
const _KMSMKID = "KMSMasterKeyID";
const _KPE = "KeyPrefixEquals";
const _L = "Location";
const _LAMBR = "ListAllMyBucketsResult";
const _LAMDBR = "ListAllMyDirectoryBucketsResult";
const _LB = "ListBuckets";
const _LBAC = "ListBucketAnalyticsConfigurations";
const _LBACO = "ListBucketAnalyticsConfigurationsOutput";
const _LBACR = "ListBucketAnalyticsConfigurationResult";
const _LBACRi = "ListBucketAnalyticsConfigurationsRequest";
const _LBIC = "ListBucketInventoryConfigurations";
const _LBICO = "ListBucketInventoryConfigurationsOutput";
const _LBICR = "ListBucketInventoryConfigurationsRequest";
const _LBITC = "ListBucketIntelligentTieringConfigurations";
const _LBITCO = "ListBucketIntelligentTieringConfigurationsOutput";
const _LBITCR = "ListBucketIntelligentTieringConfigurationsRequest";
const _LBMC = "ListBucketMetricsConfigurations";
const _LBMCO = "ListBucketMetricsConfigurationsOutput";
const _LBMCR = "ListBucketMetricsConfigurationsRequest";
const _LBO = "ListBucketsOutput";
const _LBR = "ListBucketsRequest";
const _LBRi = "ListBucketResult";
const _LC = "LocationConstraint";
const _LCi = "LifecycleConfiguration";
const _LDB = "ListDirectoryBuckets";
const _LDBO = "ListDirectoryBucketsOutput";
const _LDBR = "ListDirectoryBucketsRequest";
const _LE = "LoggingEnabled";
const _LEi = "LifecycleExpiration";
const _LFA = "LambdaFunctionArn";
const _LFC = "LambdaFunctionConfiguration";
const _LFCL = "LambdaFunctionConfigurationList";
const _LFCa = "LambdaFunctionConfigurations";
const _LH = "LegalHold";
const _LI = "LocationInfo";
const _LICR = "ListInventoryConfigurationsResult";
const _LM = "LastModified";
const _LMCR = "ListMetricsConfigurationsResult";
const _LMT = "LastModifiedTime";
const _LMU = "ListMultipartUploads";
const _LMUO = "ListMultipartUploadsOutput";
const _LMUR = "ListMultipartUploadsResult";
const _LMURi = "ListMultipartUploadsRequest";
const _LM_ = "Last-Modified";
const _LO = "ListObjects";
const _LOO = "ListObjectsOutput";
const _LOR = "ListObjectsRequest";
const _LOV = "ListObjectsV2";
const _LOVO = "ListObjectsV2Output";
const _LOVOi = "ListObjectVersionsOutput";
const _LOVR = "ListObjectsV2Request";
const _LOVRi = "ListObjectVersionsRequest";
const _LOVi = "ListObjectVersions";
const _LP = "ListParts";
const _LPO = "ListPartsOutput";
const _LPR = "ListPartsResult";
const _LPRi = "ListPartsRequest";
const _LR = "LifecycleRule";
const _LRAO = "LifecycleRuleAndOperator";
const _LRF = "LifecycleRuleFilter";
const _LRi = "LifecycleRules";
const _LVR = "ListVersionsResult";
const _M = "Metadata";
const _MAO = "MetricsAndOperator";
const _MAS = "MaxAgeSeconds";
const _MB = "MaxBuckets";
const _MC = "MetadataConfiguration";
const _MCL = "MetricsConfigurationList";
const _MCR = "MetadataConfigurationResult";
const _MCe = "MetricsConfiguration";
const _MD = "MetadataDirective";
const _MDB = "MaxDirectoryBuckets";
const _MDf = "MfaDelete";
const _ME = "MetadataEntry";
const _MF = "MetricsFilter";
const _MFA = "MFA";
const _MFAD = "MFADelete";
const _MK = "MaxKeys";
const _MM = "MissingMeta";
const _MOS = "MpuObjectSize";
const _MP = "MaxParts";
const _MTC = "MetadataTableConfiguration";
const _MTCR = "MetadataTableConfigurationResult";
const _MTEC = "MetadataTableEncryptionConfiguration";
const _MU = "MultipartUpload";
const _MUL = "MultipartUploadList";
const _MUa = "MaxUploads";
const _Ma = "Marker";
const _Me = "Metrics";
const _Mes = "Message";
const _Mi = "Minutes";
const _Mo = "Mode";
const _N = "Name";
const _NC = "NotificationConfiguration";
const _NCF = "NotificationConfigurationFilter";
const _NCT = "NextContinuationToken";
const _ND = "NoncurrentDays";
const _NEKKAS = "NonEmptyKmsKeyArnString";
const _NF = "NotFound";
const _NKM = "NextKeyMarker";
const _NM = "NextMarker";
const _NNV = "NewerNoncurrentVersions";
const _NPNM = "NextPartNumberMarker";
const _NSB = "NoSuchBucket";
const _NSK = "NoSuchKey";
const _NSU = "NoSuchUpload";
const _NUIM = "NextUploadIdMarker";
const _NVE = "NoncurrentVersionExpiration";
const _NVIM = "NextVersionIdMarker";
const _NVT = "NoncurrentVersionTransitions";
const _NVTL = "NoncurrentVersionTransitionList";
const _NVTo = "NoncurrentVersionTransition";
const _O = "Owner";
const _OA = "ObjectAttributes";
const _OAIATE = "ObjectAlreadyInActiveTierError";
const _OC = "OwnershipControls";
const _OCR = "OwnershipControlsRule";
const _OCRw = "OwnershipControlsRules";
const _OE = "ObjectEncryption";
const _OF = "OptionalFields";
const _OI = "ObjectIdentifier";
const _OIL = "ObjectIdentifierList";
const _OL = "OutputLocation";
const _OLC = "ObjectLockConfiguration";
const _OLE = "ObjectLockEnabled";
const _OLEFB = "ObjectLockEnabledForBucket";
const _OLLH = "ObjectLockLegalHold";
const _OLLHS = "ObjectLockLegalHoldStatus";
const _OLM = "ObjectLockMode";
const _OLR = "ObjectLockRetention";
const _OLRUD = "ObjectLockRetainUntilDate";
const _OLRb = "ObjectLockRule";
const _OLb = "ObjectList";
const _ONIATE = "ObjectNotInActiveTierError";
const _OO = "ObjectOwnership";
const _OOA = "OptionalObjectAttributes";
const _OP = "ObjectParts";
const _OPb = "ObjectPart";
const _OS = "ObjectSize";
const _OSGT = "ObjectSizeGreaterThan";
const _OSLT = "ObjectSizeLessThan";
const _OSV = "OutputSchemaVersion";
const _OSu = "OutputSerialization";
const _OV = "ObjectVersion";
const _OVL = "ObjectVersionList";
const _Ob = "Objects";
const _Obj = "Object";
const _P = "Prefix";
const _PABC = "PublicAccessBlockConfiguration";
const _PBA = "PutBucketAbac";
const _PBAC = "PutBucketAccelerateConfiguration";
const _PBACR = "PutBucketAccelerateConfigurationRequest";
const _PBACRu = "PutBucketAnalyticsConfigurationRequest";
const _PBACu = "PutBucketAnalyticsConfiguration";
const _PBAR = "PutBucketAbacRequest";
const _PBARu = "PutBucketAclRequest";
const _PBAu = "PutBucketAcl";
const _PBC = "PutBucketCors";
const _PBCR = "PutBucketCorsRequest";
const _PBE = "PutBucketEncryption";
const _PBER = "PutBucketEncryptionRequest";
const _PBIC = "PutBucketInventoryConfiguration";
const _PBICR = "PutBucketInventoryConfigurationRequest";
const _PBITC = "PutBucketIntelligentTieringConfiguration";
const _PBITCR = "PutBucketIntelligentTieringConfigurationRequest";
const _PBL = "PutBucketLogging";
const _PBLC = "PutBucketLifecycleConfiguration";
const _PBLCO = "PutBucketLifecycleConfigurationOutput";
const _PBLCR = "PutBucketLifecycleConfigurationRequest";
const _PBLR = "PutBucketLoggingRequest";
const _PBMC = "PutBucketMetricsConfiguration";
const _PBMCR = "PutBucketMetricsConfigurationRequest";
const _PBNC = "PutBucketNotificationConfiguration";
const _PBNCR = "PutBucketNotificationConfigurationRequest";
const _PBOC = "PutBucketOwnershipControls";
const _PBOCR = "PutBucketOwnershipControlsRequest";
const _PBP = "PutBucketPolicy";
const _PBPR = "PutBucketPolicyRequest";
const _PBR = "PutBucketReplication";
const _PBRP = "PutBucketRequestPayment";
const _PBRPR = "PutBucketRequestPaymentRequest";
const _PBRR = "PutBucketReplicationRequest";
const _PBT = "PutBucketTagging";
const _PBTR = "PutBucketTaggingRequest";
const _PBV = "PutBucketVersioning";
const _PBVR = "PutBucketVersioningRequest";
const _PBW = "PutBucketWebsite";
const _PBWR = "PutBucketWebsiteRequest";
const _PC = "PartsCount";
const _PDS = "PartitionDateSource";
const _PE = "ProgressEvent";
const _PI = "ParquetInput";
const _PL = "PartsList";
const _PN = "PartNumber";
const _PNM = "PartNumberMarker";
const _PO = "PutObject";
const _POA = "PutObjectAcl";
const _POAO = "PutObjectAclOutput";
const _POAR = "PutObjectAclRequest";
const _POLC = "PutObjectLockConfiguration";
const _POLCO = "PutObjectLockConfigurationOutput";
const _POLCR = "PutObjectLockConfigurationRequest";
const _POLH = "PutObjectLegalHold";
const _POLHO = "PutObjectLegalHoldOutput";
const _POLHR = "PutObjectLegalHoldRequest";
const _POO = "PutObjectOutput";
const _POR = "PutObjectRequest";
const _PORO = "PutObjectRetentionOutput";
const _PORR = "PutObjectRetentionRequest";
const _PORu = "PutObjectRetention";
const _POT = "PutObjectTagging";
const _POTO = "PutObjectTaggingOutput";
const _POTR = "PutObjectTaggingRequest";
const _PP = "PartitionedPrefix";
const _PPAB = "PutPublicAccessBlock";
const _PPABR = "PutPublicAccessBlockRequest";
const _PS = "PolicyStatus";
const _Pa = "Parts";
const _Par = "Part";
const _Parq = "Parquet";
const _Pay = "Payer";
const _Payl = "Payload";
const _Pe = "Permission";
const _Po = "Policy";
const _Pr = "Progress";
const _Pri = "Priority";
const _Pro = "Protocol";
const _Q = "Quiet";
const _QA = "QueueArn";
const _QC = "QuoteCharacter";
const _QCL = "QueueConfigurationList";
const _QCu = "QueueConfigurations";
const _QCue = "QueueConfiguration";
const _QEC = "QuoteEscapeCharacter";
const _QF = "QuoteFields";
const _Qu = "Queue";
const _R = "Rules";
const _RART = "RedirectAllRequestsTo";
const _RC = "RequestCharged";
const _RCC = "ResponseCacheControl";
const _RCD = "ResponseContentDisposition";
const _RCE = "ResponseContentEncoding";
const _RCL = "ResponseContentLanguage";
const _RCT = "ResponseContentType";
const _RCe = "ReplicationConfiguration";
const _RD = "RecordDelimiter";
const _RE = "ResponseExpires";
const _RED = "RestoreExpiryDate";
const _REe = "RecordExpiration";
const _REec = "RecordsEvent";
const _RKKID = "ReplicaKmsKeyID";
const _RKPW = "ReplaceKeyPrefixWith";
const _RKW = "ReplaceKeyWith";
const _RM = "ReplicaModifications";
const _RO = "RenameObject";
const _ROO = "RenameObjectOutput";
const _ROOe = "RestoreObjectOutput";
const _ROP = "RestoreOutputPath";
const _ROR = "RenameObjectRequest";
const _RORe = "RestoreObjectRequest";
const _ROe = "RestoreObject";
const _RP = "RequestPayer";
const _RPB = "RestrictPublicBuckets";
const _RPC = "RequestPaymentConfiguration";
const _RPe = "RequestProgress";
const _RR = "RoutingRules";
const _RRAO = "ReplicationRuleAndOperator";
const _RRF = "ReplicationRuleFilter";
const _RRe = "ReplicationRule";
const _RRep = "ReplicationRules";
const _RReq = "RequestRoute";
const _RRes = "RestoreRequest";
const _RRo = "RoutingRule";
const _RS = "ReplicationStatus";
const _RSe = "RestoreStatus";
const _RSen = "RenameSource";
const _RT = "ReplicationTime";
const _RTV = "ReplicationTimeValue";
const _RTe = "RequestToken";
const _RUD = "RetainUntilDate";
const _Ra = "Range";
const _Re = "Restore";
const _Rec = "Records";
const _Red = "Redirect";
const _Ret = "Retention";
const _Ro = "Role";
const _Ru = "Rule";
const _S = "Status";
const _SA = "StartAfter";
const _SAK = "SecretAccessKey";
const _SAs = "SseAlgorithm";
const _SB = "StreamingBlob";
const _SBD = "S3BucketDestination";
const _SC = "StorageClass";
const _SCA = "StorageClassAnalysis";
const _SCADE = "StorageClassAnalysisDataExport";
const _SCV = "SessionCredentialValue";
const _SCe = "SessionCredentials";
const _SCt = "StatusCode";
const _SDV = "SkipDestinationValidation";
const _SE = "StatsEvent";
const _SIM = "SourceIfMatch";
const _SIMS = "SourceIfModifiedSince";
const _SINM = "SourceIfNoneMatch";
const _SIUS = "SourceIfUnmodifiedSince";
const _SK = "SSE-KMS";
const _SKEO = "SseKmsEncryptedObjects";
const _SKF = "S3KeyFilter";
const _SKe = "S3Key";
const _SL = "S3Location";
const _SM = "SessionMode";
const _SOC = "SelectObjectContent";
const _SOCES = "SelectObjectContentEventStream";
const _SOCO = "SelectObjectContentOutput";
const _SOCR = "SelectObjectContentRequest";
const _SP = "SelectParameters";
const _SPi = "SimplePrefix";
const _SR = "ScanRange";
const _SS = "SSE-S3";
const _SSC = "SourceSelectionCriteria";
const _SSE = "ServerSideEncryption";
const _SSEA = "SSEAlgorithm";
const _SSEBD = "ServerSideEncryptionByDefault";
const _SSEC = "ServerSideEncryptionConfiguration";
const _SSECA = "SSECustomerAlgorithm";
const _SSECK = "SSECustomerKey";
const _SSECKMD = "SSECustomerKeyMD5";
const _SSEKMS = "SSEKMS";
const _SSEKMSE = "SSEKMSEncryption";
const _SSEKMSEC = "SSEKMSEncryptionContext";
const _SSEKMSKI = "SSEKMSKeyId";
const _SSER = "ServerSideEncryptionRule";
const _SSERe = "ServerSideEncryptionRules";
const _SSES = "SSES3";
const _ST = "SessionToken";
const _STD = "S3TablesDestination";
const _STDR = "S3TablesDestinationResult";
const _S_ = "S3";
const _Sc = "Schedule";
const _Si = "Size";
const _St = "Start";
const _Sta = "Stats";
const _Su = "Suffix";
const _T = "Tags";
const _TA = "TableArn";
const _TAo = "TopicArn";
const _TB = "TargetBucket";
const _TBA = "TableBucketArn";
const _TBT = "TableBucketType";
const _TC = "TagCount";
const _TCL = "TopicConfigurationList";
const _TCo = "TopicConfigurations";
const _TCop = "TopicConfiguration";
const _TD = "TaggingDirective";
const _TDMOS = "TransitionDefaultMinimumObjectSize";
const _TG = "TargetGrants";
const _TGa = "TargetGrant";
const _TL = "TieringList";
const _TLr = "TransitionList";
const _TMP = "TooManyParts";
const _TN = "TableNamespace";
const _TNa = "TableName";
const _TOKF = "TargetObjectKeyFormat";
const _TP = "TargetPrefix";
const _TPC = "TotalPartsCount";
const _TS = "TagSet";
const _TSa = "TableStatus";
const _Ta = "Tag";
const _Tag = "Tagging";
const _Ti = "Tier";
const _Tie = "Tierings";
const _Tier = "Tiering";
const _Tim = "Time";
const _To = "Token";
const _Top = "Topic";
const _Tr = "Transitions";
const _Tra = "Transition";
const _Ty = "Type";
const _U = "Uploads";
const _UBMITC = "UpdateBucketMetadataInventoryTableConfiguration";
const _UBMITCR = "UpdateBucketMetadataInventoryTableConfigurationRequest";
const _UBMJTC = "UpdateBucketMetadataJournalTableConfiguration";
const _UBMJTCR = "UpdateBucketMetadataJournalTableConfigurationRequest";
const _UI = "UploadId";
const _UIM = "UploadIdMarker";
const _UM = "UserMetadata";
const _UOE = "UpdateObjectEncryption";
const _UOER = "UpdateObjectEncryptionRequest";
const _UOERp = "UpdateObjectEncryptionResponse";
const _UP = "UploadPart";
const _UPC = "UploadPartCopy";
const _UPCO = "UploadPartCopyOutput";
const _UPCR = "UploadPartCopyRequest";
const _UPO = "UploadPartOutput";
const _UPR = "UploadPartRequest";
const _URI = "URI";
const _Up = "Upload";
const _V = "Value";
const _VC = "VersioningConfiguration";
const _VI = "VersionId";
const _VIM = "VersionIdMarker";
const _Ve = "Versions";
const _Ver = "Version";
const _WC = "WebsiteConfiguration";
const _WGOR = "WriteGetObjectResponse";
const _WGORR = "WriteGetObjectResponseRequest";
const _WOB = "WriteOffsetBytes";
const _WRL = "WebsiteRedirectLocation";
const _Y = "Years";
const _ar = "accept-ranges";
const _br = "bucket-region";
const _c = "client";
const _ct = "continuation-token";
const _d = "delimiter";
const _e = "error";
const _eP = "eventPayload";
const _en = "endpoint";
const _et = "encoding-type";
const _fo = "fetch-owner";
const _h = "http";
const _hC = "httpChecksum";
const _hE = "httpError";
const _hH = "httpHeader";
const _hL = "hostLabel";
const _hP = "httpPayload";
const _hPH = "httpPrefixHeaders";
const _hQ = "httpQuery";
const _hi = "http://www.w3.org/2001/XMLSchema-instance";
const _i = "id";
const _iT = "idempotencyToken";
const _km = "key-marker";
const _m = "marker";
const _mb = "max-buckets";
const _mdb = "max-directory-buckets";
const _mk = "max-keys";
const _mp = "max-parts";
const _mu = "max-uploads";
const _p = "prefix";
const _pN = "partNumber";
const _pnm = "part-number-marker";
const _rcc = "response-cache-control";
const _rcd = "response-content-disposition";
const _rce = "response-content-encoding";
const _rcl = "response-content-language";
const _rct = "response-content-type";
const _re = "response-expires";
const _s = "smithy.ts.sdk.synthetic.com.amazonaws.s3";
const _sa = "start-after";
const _st = "streaming";
const _uI = "uploadId";
const _uim = "upload-id-marker";
const _vI = "versionId";
const _vim = "version-id-marker";
const _x = "xsi";
const _xA = "xmlAttribute";
const _xF = "xmlFlattened";
const _xN = "xmlName";
const _xNm = "xmlNamespace";
const _xaa = "x-amz-acl";
const _xaad = "x-amz-abort-date";
const _xaapa = "x-amz-access-point-alias";
const _xaari = "x-amz-abort-rule-id";
const _xaas = "x-amz-archive-status";
const _xaba = "x-amz-bucket-arn";
const _xabgr = "x-amz-bypass-governance-retention";
const _xabln = "x-amz-bucket-location-name";
const _xablt = "x-amz-bucket-location-type";
const _xabole = "x-amz-bucket-object-lock-enabled";
const _xabolt = "x-amz-bucket-object-lock-token";
const _xabr = "x-amz-bucket-region";
const _xaca = "x-amz-checksum-algorithm";
const _xacc = "x-amz-checksum-crc32";
const _xacc_ = "x-amz-checksum-crc32c";
const _xacc__ = "x-amz-checksum-crc64nvme";
const _xacm = "x-amz-checksum-mode";
const _xacrsba = "x-amz-confirm-remove-self-bucket-access";
const _xacs = "x-amz-checksum-sha1";
const _xacs_ = "x-amz-checksum-sha256";
const _xacs__ = "x-amz-copy-source";
const _xacsim = "x-amz-copy-source-if-match";
const _xacsims = "x-amz-copy-source-if-modified-since";
const _xacsinm = "x-amz-copy-source-if-none-match";
const _xacsius = "x-amz-copy-source-if-unmodified-since";
const _xacsm = "x-amz-create-session-mode";
const _xacsr = "x-amz-copy-source-range";
const _xacssseca = "x-amz-copy-source-server-side-encryption-customer-algorithm";
const _xacssseck = "x-amz-copy-source-server-side-encryption-customer-key";
const _xacssseckM = "x-amz-copy-source-server-side-encryption-customer-key-MD5";
const _xacsvi = "x-amz-copy-source-version-id";
const _xact = "x-amz-checksum-type";
const _xact_ = "x-amz-client-token";
const _xadm = "x-amz-delete-marker";
const _xae = "x-amz-expiration";
const _xaebo = "x-amz-expected-bucket-owner";
const _xafec = "x-amz-fwd-error-code";
const _xafem = "x-amz-fwd-error-message";
const _xafhCC = "x-amz-fwd-header-Cache-Control";
const _xafhCD = "x-amz-fwd-header-Content-Disposition";
const _xafhCE = "x-amz-fwd-header-Content-Encoding";
const _xafhCL = "x-amz-fwd-header-Content-Language";
const _xafhCR = "x-amz-fwd-header-Content-Range";
const _xafhCT = "x-amz-fwd-header-Content-Type";
const _xafhE = "x-amz-fwd-header-ETag";
const _xafhE_ = "x-amz-fwd-header-Expires";
const _xafhLM = "x-amz-fwd-header-Last-Modified";
const _xafhar = "x-amz-fwd-header-accept-ranges";
const _xafhxacc = "x-amz-fwd-header-x-amz-checksum-crc32";
const _xafhxacc_ = "x-amz-fwd-header-x-amz-checksum-crc32c";
const _xafhxacc__ = "x-amz-fwd-header-x-amz-checksum-crc64nvme";
const _xafhxacs = "x-amz-fwd-header-x-amz-checksum-sha1";
const _xafhxacs_ = "x-amz-fwd-header-x-amz-checksum-sha256";
const _xafhxadm = "x-amz-fwd-header-x-amz-delete-marker";
const _xafhxae = "x-amz-fwd-header-x-amz-expiration";
const _xafhxamm = "x-amz-fwd-header-x-amz-missing-meta";
const _xafhxampc = "x-amz-fwd-header-x-amz-mp-parts-count";
const _xafhxaollh = "x-amz-fwd-header-x-amz-object-lock-legal-hold";
const _xafhxaolm = "x-amz-fwd-header-x-amz-object-lock-mode";
const _xafhxaolrud = "x-amz-fwd-header-x-amz-object-lock-retain-until-date";
const _xafhxar = "x-amz-fwd-header-x-amz-restore";
const _xafhxarc = "x-amz-fwd-header-x-amz-request-charged";
const _xafhxars = "x-amz-fwd-header-x-amz-replication-status";
const _xafhxasc = "x-amz-fwd-header-x-amz-storage-class";
const _xafhxasse = "x-amz-fwd-header-x-amz-server-side-encryption";
const _xafhxasseakki = "x-amz-fwd-header-x-amz-server-side-encryption-aws-kms-key-id";
const _xafhxassebke = "x-amz-fwd-header-x-amz-server-side-encryption-bucket-key-enabled";
const _xafhxasseca = "x-amz-fwd-header-x-amz-server-side-encryption-customer-algorithm";
const _xafhxasseckM = "x-amz-fwd-header-x-amz-server-side-encryption-customer-key-MD5";
const _xafhxatc = "x-amz-fwd-header-x-amz-tagging-count";
const _xafhxavi = "x-amz-fwd-header-x-amz-version-id";
const _xafs = "x-amz-fwd-status";
const _xagfc = "x-amz-grant-full-control";
const _xagr = "x-amz-grant-read";
const _xagra = "x-amz-grant-read-acp";
const _xagw = "x-amz-grant-write";
const _xagwa = "x-amz-grant-write-acp";
const _xaimit = "x-amz-if-match-initiated-time";
const _xaimlmt = "x-amz-if-match-last-modified-time";
const _xaims = "x-amz-if-match-size";
const _xam = "x-amz-meta-";
const _xam_ = "x-amz-mfa";
const _xamd = "x-amz-metadata-directive";
const _xamm = "x-amz-missing-meta";
const _xamos = "x-amz-mp-object-size";
const _xamp = "x-amz-max-parts";
const _xampc = "x-amz-mp-parts-count";
const _xaoa = "x-amz-object-attributes";
const _xaollh = "x-amz-object-lock-legal-hold";
const _xaolm = "x-amz-object-lock-mode";
const _xaolrud = "x-amz-object-lock-retain-until-date";
const _xaoo = "x-amz-object-ownership";
const _xaooa = "x-amz-optional-object-attributes";
const _xaos = "x-amz-object-size";
const _xapnm = "x-amz-part-number-marker";
const _xar = "x-amz-restore";
const _xarc = "x-amz-request-charged";
const _xarop = "x-amz-restore-output-path";
const _xarp = "x-amz-request-payer";
const _xarr = "x-amz-request-route";
const _xars = "x-amz-replication-status";
const _xars_ = "x-amz-rename-source";
const _xarsim = "x-amz-rename-source-if-match";
const _xarsims = "x-amz-rename-source-if-modified-since";
const _xarsinm = "x-amz-rename-source-if-none-match";
const _xarsius = "x-amz-rename-source-if-unmodified-since";
const _xart = "x-amz-request-token";
const _xasc = "x-amz-storage-class";
const _xasca = "x-amz-sdk-checksum-algorithm";
const _xasdv = "x-amz-skip-destination-validation";
const _xasebo = "x-amz-source-expected-bucket-owner";
const _xasse = "x-amz-server-side-encryption";
const _xasseakki = "x-amz-server-side-encryption-aws-kms-key-id";
const _xassebke = "x-amz-server-side-encryption-bucket-key-enabled";
const _xassec = "x-amz-server-side-encryption-context";
const _xasseca = "x-amz-server-side-encryption-customer-algorithm";
const _xasseck = "x-amz-server-side-encryption-customer-key";
const _xasseckM = "x-amz-server-side-encryption-customer-key-MD5";
const _xat = "x-amz-tagging";
const _xatc = "x-amz-tagging-count";
const _xatd = "x-amz-tagging-directive";
const _xatdmos = "x-amz-transition-default-minimum-object-size";
const _xavi = "x-amz-version-id";
const _xawob = "x-amz-write-offset-bytes";
const _xawrl = "x-amz-website-redirect-location";
const _xs = "xsi:type";
const n0 = "com.amazonaws.s3";
const schema_1 = __webpack_require__(15982);
const errors_1 = __webpack_require__(65003);
const S3ServiceException_1 = __webpack_require__(64534);
const _s_registry = schema_1.TypeRegistry.for(_s);
exports.S3ServiceException$ = [-3, _s, "S3ServiceException", 0, [], []];
_s_registry.registerError(exports.S3ServiceException$, S3ServiceException_1.S3ServiceException);
const n0_registry = schema_1.TypeRegistry.for(n0);
exports.AccessDenied$ = [-3, n0, _AD,
    { [_e]: _c, [_hE]: 403 },
    [],
    []
];
n0_registry.registerError(exports.AccessDenied$, errors_1.AccessDenied);
exports.BucketAlreadyExists$ = [-3, n0, _BAE,
    { [_e]: _c, [_hE]: 409 },
    [],
    []
];
n0_registry.registerError(exports.BucketAlreadyExists$, errors_1.BucketAlreadyExists);
exports.BucketAlreadyOwnedByYou$ = [-3, n0, _BAOBY,
    { [_e]: _c, [_hE]: 409 },
    [],
    []
];
n0_registry.registerError(exports.BucketAlreadyOwnedByYou$, errors_1.BucketAlreadyOwnedByYou);
exports.EncryptionTypeMismatch$ = [-3, n0, _ETM,
    { [_e]: _c, [_hE]: 400 },
    [],
    []
];
n0_registry.registerError(exports.EncryptionTypeMismatch$, errors_1.EncryptionTypeMismatch);
exports.IdempotencyParameterMismatch$ = [-3, n0, _IPM,
    { [_e]: _c, [_hE]: 400 },
    [],
    []
];
n0_registry.registerError(exports.IdempotencyParameterMismatch$, errors_1.IdempotencyParameterMismatch);
exports.InvalidObjectState$ = [-3, n0, _IOS,
    { [_e]: _c, [_hE]: 403 },
    [_SC, _AT],
    [0, 0]
];
n0_registry.registerError(exports.InvalidObjectState$, errors_1.InvalidObjectState);
exports.InvalidRequest$ = [-3, n0, _IR,
    { [_e]: _c, [_hE]: 400 },
    [],
    []
];
n0_registry.registerError(exports.InvalidRequest$, errors_1.InvalidRequest);
exports.InvalidWriteOffset$ = [-3, n0, _IWO,
    { [_e]: _c, [_hE]: 400 },
    [],
    []
];
n0_registry.registerError(exports.InvalidWriteOffset$, errors_1.InvalidWriteOffset);
exports.NoSuchBucket$ = [-3, n0, _NSB,
    { [_e]: _c, [_hE]: 404 },
    [],
    []
];
n0_registry.registerError(exports.NoSuchBucket$, errors_1.NoSuchBucket);
exports.NoSuchKey$ = [-3, n0, _NSK,
    { [_e]: _c, [_hE]: 404 },
    [],
    []
];
n0_registry.registerError(exports.NoSuchKey$, errors_1.NoSuchKey);
exports.NoSuchUpload$ = [-3, n0, _NSU,
    { [_e]: _c, [_hE]: 404 },
    [],
    []
];
n0_registry.registerError(exports.NoSuchUpload$, errors_1.NoSuchUpload);
exports.NotFound$ = [-3, n0, _NF,
    { [_e]: _c },
    [],
    []
];
n0_registry.registerError(exports.NotFound$, errors_1.NotFound);
exports.ObjectAlreadyInActiveTierError$ = [-3, n0, _OAIATE,
    { [_e]: _c, [_hE]: 403 },
    [],
    []
];
n0_registry.registerError(exports.ObjectAlreadyInActiveTierError$, errors_1.ObjectAlreadyInActiveTierError);
exports.ObjectNotInActiveTierError$ = [-3, n0, _ONIATE,
    { [_e]: _c, [_hE]: 403 },
    [],
    []
];
n0_registry.registerError(exports.ObjectNotInActiveTierError$, errors_1.ObjectNotInActiveTierError);
exports.TooManyParts$ = [-3, n0, _TMP,
    { [_e]: _c, [_hE]: 400 },
    [],
    []
];
n0_registry.registerError(exports.TooManyParts$, errors_1.TooManyParts);
exports.errorTypeRegistries = [
    _s_registry,
    n0_registry,
];
var CopySourceSSECustomerKey = [0, n0, _CSSSECK, 8, 0];
var NonEmptyKmsKeyArnString = [0, n0, _NEKKAS, 8, 0];
var SessionCredentialValue = [0, n0, _SCV, 8, 0];
var SSECustomerKey = [0, n0, _SSECK, 8, 0];
var SSEKMSEncryptionContext = [0, n0, _SSEKMSEC, 8, 0];
var SSEKMSKeyId = [0, n0, _SSEKMSKI, 8, 0];
var StreamingBlob = [0, n0, _SB, { [_st]: 1 }, 42];
exports.AbacStatus$ = [3, n0, _AS,
    0,
    [_S],
    [0]
];
exports.AbortIncompleteMultipartUpload$ = [3, n0, _AIMU,
    0,
    [_DAI],
    [1]
];
exports.AbortMultipartUploadOutput$ = [3, n0, _AMUO,
    0,
    [_RC],
    [[0, { [_hH]: _xarc }]]
];
exports.AbortMultipartUploadRequest$ = [3, n0, _AMUR,
    0,
    [_B, _K, _UI, _RP, _EBO, _IMIT],
    [[0, 1], [0, 1], [0, { [_hQ]: _uI }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xaebo }], [6, { [_hH]: _xaimit }]], 3
];
exports.AccelerateConfiguration$ = [3, n0, _AC,
    0,
    [_S],
    [0]
];
exports.AccessControlPolicy$ = [3, n0, _ACP,
    0,
    [_G, _O],
    [[() => Grants, { [_xN]: _ACL }], () => exports.Owner$]
];
exports.AccessControlTranslation$ = [3, n0, _ACT,
    0,
    [_O],
    [0], 1
];
exports.AnalyticsAndOperator$ = [3, n0, _AAO,
    0,
    [_P, _T],
    [0, [() => TagSet, { [_xF]: 1, [_xN]: _Ta }]]
];
exports.AnalyticsConfiguration$ = [3, n0, _ACn,
    0,
    [_I, _SCA, _F],
    [0, () => exports.StorageClassAnalysis$, [() => exports.AnalyticsFilter$, 0]], 2
];
exports.AnalyticsExportDestination$ = [3, n0, _AED,
    0,
    [_SBD],
    [() => exports.AnalyticsS3BucketDestination$], 1
];
exports.AnalyticsS3BucketDestination$ = [3, n0, _ASBD,
    0,
    [_Fo, _B, _BAI, _P],
    [0, 0, 0, 0], 2
];
exports.BlockedEncryptionTypes$ = [3, n0, _BET,
    0,
    [_ET],
    [[() => EncryptionTypeList, { [_xF]: 1 }]]
];
exports.Bucket$ = [3, n0, _B,
    0,
    [_N, _CD, _BR, _BA],
    [0, 4, 0, 0]
];
exports.BucketInfo$ = [3, n0, _BI,
    0,
    [_DR, _Ty],
    [0, 0]
];
exports.BucketLifecycleConfiguration$ = [3, n0, _BLC,
    0,
    [_R],
    [[() => LifecycleRules, { [_xF]: 1, [_xN]: _Ru }]], 1
];
exports.BucketLoggingStatus$ = [3, n0, _BLS,
    0,
    [_LE],
    [[() => exports.LoggingEnabled$, 0]]
];
exports.Checksum$ = [3, n0, _C,
    0,
    [_CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh, _CT],
    [0, 0, 0, 0, 0, 0]
];
exports.CommonPrefix$ = [3, n0, _CP,
    0,
    [_P],
    [0]
];
exports.CompletedMultipartUpload$ = [3, n0, _CMU,
    0,
    [_Pa],
    [[() => CompletedPartList, { [_xF]: 1, [_xN]: _Par }]]
];
exports.CompletedPart$ = [3, n0, _CPo,
    0,
    [_ETa, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh, _PN],
    [0, 0, 0, 0, 0, 0, 1]
];
exports.CompleteMultipartUploadOutput$ = [3, n0, _CMUO,
    { [_xN]: _CMUR },
    [_L, _B, _K, _E, _ETa, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh, _CT, _SSE, _VI, _SSEKMSKI, _BKE, _RC],
    [0, 0, 0, [0, { [_hH]: _xae }], 0, 0, 0, 0, 0, 0, 0, [0, { [_hH]: _xasse }], [0, { [_hH]: _xavi }], [() => SSEKMSKeyId, { [_hH]: _xasseakki }], [2, { [_hH]: _xassebke }], [0, { [_hH]: _xarc }]]
];
exports.CompleteMultipartUploadRequest$ = [3, n0, _CMURo,
    0,
    [_B, _K, _UI, _MU, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh, _CT, _MOS, _RP, _EBO, _IM, _INM, _SSECA, _SSECK, _SSECKMD],
    [[0, 1], [0, 1], [0, { [_hQ]: _uI }], [() => exports.CompletedMultipartUpload$, { [_hP]: 1, [_xN]: _CMUo }], [0, { [_hH]: _xacc }], [0, { [_hH]: _xacc_ }], [0, { [_hH]: _xacc__ }], [0, { [_hH]: _xacs }], [0, { [_hH]: _xacs_ }], [0, { [_hH]: _xact }], [1, { [_hH]: _xamos }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _IM_ }], [0, { [_hH]: _INM_ }], [0, { [_hH]: _xasseca }], [() => SSECustomerKey, { [_hH]: _xasseck }], [0, { [_hH]: _xasseckM }]], 3
];
exports.Condition$ = [3, n0, _Co,
    0,
    [_HECRE, _KPE],
    [0, 0]
];
exports.ContinuationEvent$ = [3, n0, _CE,
    0,
    [],
    []
];
exports.CopyObjectOutput$ = [3, n0, _COO,
    0,
    [_COR, _E, _CSVI, _VI, _SSE, _SSECA, _SSECKMD, _SSEKMSKI, _SSEKMSEC, _BKE, _RC],
    [[() => exports.CopyObjectResult$, 16], [0, { [_hH]: _xae }], [0, { [_hH]: _xacsvi }], [0, { [_hH]: _xavi }], [0, { [_hH]: _xasse }], [0, { [_hH]: _xasseca }], [0, { [_hH]: _xasseckM }], [() => SSEKMSKeyId, { [_hH]: _xasseakki }], [() => SSEKMSEncryptionContext, { [_hH]: _xassec }], [2, { [_hH]: _xassebke }], [0, { [_hH]: _xarc }]]
];
exports.CopyObjectRequest$ = [3, n0, _CORo,
    0,
    [_B, _CS, _K, _ACL_, _CC, _CA, _CDo, _CEo, _CL, _CTo, _CSIM, _CSIMS, _CSINM, _CSIUS, _Ex, _GFC, _GR, _GRACP, _GWACP, _IM, _INM, _M, _MD, _TD, _SSE, _SC, _WRL, _SSECA, _SSECK, _SSECKMD, _SSEKMSKI, _SSEKMSEC, _BKE, _CSSSECA, _CSSSECK, _CSSSECKMD, _RP, _Tag, _OLM, _OLRUD, _OLLHS, _EBO, _ESBO],
    [[0, 1], [0, { [_hH]: _xacs__ }], [0, 1], [0, { [_hH]: _xaa }], [0, { [_hH]: _CC_ }], [0, { [_hH]: _xaca }], [0, { [_hH]: _CD_ }], [0, { [_hH]: _CE_ }], [0, { [_hH]: _CL_ }], [0, { [_hH]: _CT_ }], [0, { [_hH]: _xacsim }], [4, { [_hH]: _xacsims }], [0, { [_hH]: _xacsinm }], [4, { [_hH]: _xacsius }], [4, { [_hH]: _Ex }], [0, { [_hH]: _xagfc }], [0, { [_hH]: _xagr }], [0, { [_hH]: _xagra }], [0, { [_hH]: _xagwa }], [0, { [_hH]: _IM_ }], [0, { [_hH]: _INM_ }], [128 | 0, { [_hPH]: _xam }], [0, { [_hH]: _xamd }], [0, { [_hH]: _xatd }], [0, { [_hH]: _xasse }], [0, { [_hH]: _xasc }], [0, { [_hH]: _xawrl }], [0, { [_hH]: _xasseca }], [() => SSECustomerKey, { [_hH]: _xasseck }], [0, { [_hH]: _xasseckM }], [() => SSEKMSKeyId, { [_hH]: _xasseakki }], [() => SSEKMSEncryptionContext, { [_hH]: _xassec }], [2, { [_hH]: _xassebke }], [0, { [_hH]: _xacssseca }], [() => CopySourceSSECustomerKey, { [_hH]: _xacssseck }], [0, { [_hH]: _xacssseckM }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xat }], [0, { [_hH]: _xaolm }], [5, { [_hH]: _xaolrud }], [0, { [_hH]: _xaollh }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xasebo }]], 3
];
exports.CopyObjectResult$ = [3, n0, _COR,
    0,
    [_ETa, _LM, _CT, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh],
    [0, 4, 0, 0, 0, 0, 0, 0]
];
exports.CopyPartResult$ = [3, n0, _CPR,
    0,
    [_ETa, _LM, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh],
    [0, 4, 0, 0, 0, 0, 0]
];
exports.CORSConfiguration$ = [3, n0, _CORSC,
    0,
    [_CORSR],
    [[() => CORSRules, { [_xF]: 1, [_xN]: _CORSRu }]], 1
];
exports.CORSRule$ = [3, n0, _CORSRu,
    0,
    [_AM, _AO, _ID, _AH, _EH, _MAS],
    [[64 | 0, { [_xF]: 1, [_xN]: _AMl }], [64 | 0, { [_xF]: 1, [_xN]: _AOl }], 0, [64 | 0, { [_xF]: 1, [_xN]: _AHl }], [64 | 0, { [_xF]: 1, [_xN]: _EHx }], 1], 2
];
exports.CreateBucketConfiguration$ = [3, n0, _CBC,
    0,
    [_LC, _L, _B, _T],
    [0, () => exports.LocationInfo$, () => exports.BucketInfo$, [() => TagSet, 0]]
];
exports.CreateBucketMetadataConfigurationRequest$ = [3, n0, _CBMCR,
    0,
    [_B, _MC, _CMD, _CA, _EBO],
    [[0, 1], [() => exports.MetadataConfiguration$, { [_hP]: 1, [_xN]: _MC }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.CreateBucketMetadataTableConfigurationRequest$ = [3, n0, _CBMTCR,
    0,
    [_B, _MTC, _CMD, _CA, _EBO],
    [[0, 1], [() => exports.MetadataTableConfiguration$, { [_hP]: 1, [_xN]: _MTC }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.CreateBucketOutput$ = [3, n0, _CBO,
    0,
    [_L, _BA],
    [[0, { [_hH]: _L }], [0, { [_hH]: _xaba }]]
];
exports.CreateBucketRequest$ = [3, n0, _CBR,
    0,
    [_B, _ACL_, _CBC, _GFC, _GR, _GRACP, _GW, _GWACP, _OLEFB, _OO],
    [[0, 1], [0, { [_hH]: _xaa }], [() => exports.CreateBucketConfiguration$, { [_hP]: 1, [_xN]: _CBC }], [0, { [_hH]: _xagfc }], [0, { [_hH]: _xagr }], [0, { [_hH]: _xagra }], [0, { [_hH]: _xagw }], [0, { [_hH]: _xagwa }], [2, { [_hH]: _xabole }], [0, { [_hH]: _xaoo }]], 1
];
exports.CreateMultipartUploadOutput$ = [3, n0, _CMUOr,
    { [_xN]: _IMUR },
    [_ADb, _ARI, _B, _K, _UI, _SSE, _SSECA, _SSECKMD, _SSEKMSKI, _SSEKMSEC, _BKE, _RC, _CA, _CT],
    [[4, { [_hH]: _xaad }], [0, { [_hH]: _xaari }], [0, { [_xN]: _B }], 0, 0, [0, { [_hH]: _xasse }], [0, { [_hH]: _xasseca }], [0, { [_hH]: _xasseckM }], [() => SSEKMSKeyId, { [_hH]: _xasseakki }], [() => SSEKMSEncryptionContext, { [_hH]: _xassec }], [2, { [_hH]: _xassebke }], [0, { [_hH]: _xarc }], [0, { [_hH]: _xaca }], [0, { [_hH]: _xact }]]
];
exports.CreateMultipartUploadRequest$ = [3, n0, _CMURr,
    0,
    [_B, _K, _ACL_, _CC, _CDo, _CEo, _CL, _CTo, _Ex, _GFC, _GR, _GRACP, _GWACP, _M, _SSE, _SC, _WRL, _SSECA, _SSECK, _SSECKMD, _SSEKMSKI, _SSEKMSEC, _BKE, _RP, _Tag, _OLM, _OLRUD, _OLLHS, _EBO, _CA, _CT],
    [[0, 1], [0, 1], [0, { [_hH]: _xaa }], [0, { [_hH]: _CC_ }], [0, { [_hH]: _CD_ }], [0, { [_hH]: _CE_ }], [0, { [_hH]: _CL_ }], [0, { [_hH]: _CT_ }], [4, { [_hH]: _Ex }], [0, { [_hH]: _xagfc }], [0, { [_hH]: _xagr }], [0, { [_hH]: _xagra }], [0, { [_hH]: _xagwa }], [128 | 0, { [_hPH]: _xam }], [0, { [_hH]: _xasse }], [0, { [_hH]: _xasc }], [0, { [_hH]: _xawrl }], [0, { [_hH]: _xasseca }], [() => SSECustomerKey, { [_hH]: _xasseck }], [0, { [_hH]: _xasseckM }], [() => SSEKMSKeyId, { [_hH]: _xasseakki }], [() => SSEKMSEncryptionContext, { [_hH]: _xassec }], [2, { [_hH]: _xassebke }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xat }], [0, { [_hH]: _xaolm }], [5, { [_hH]: _xaolrud }], [0, { [_hH]: _xaollh }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xaca }], [0, { [_hH]: _xact }]], 2
];
exports.CreateSessionOutput$ = [3, n0, _CSO,
    { [_xN]: _CSR },
    [_Cr, _SSE, _SSEKMSKI, _SSEKMSEC, _BKE],
    [[() => exports.SessionCredentials$, { [_xN]: _Cr }], [0, { [_hH]: _xasse }], [() => SSEKMSKeyId, { [_hH]: _xasseakki }], [() => SSEKMSEncryptionContext, { [_hH]: _xassec }], [2, { [_hH]: _xassebke }]], 1
];
exports.CreateSessionRequest$ = [3, n0, _CSRr,
    0,
    [_B, _SM, _SSE, _SSEKMSKI, _SSEKMSEC, _BKE],
    [[0, 1], [0, { [_hH]: _xacsm }], [0, { [_hH]: _xasse }], [() => SSEKMSKeyId, { [_hH]: _xasseakki }], [() => SSEKMSEncryptionContext, { [_hH]: _xassec }], [2, { [_hH]: _xassebke }]], 1
];
exports.CSVInput$ = [3, n0, _CSVIn,
    0,
    [_FHI, _Com, _QEC, _RD, _FD, _QC, _AQRD],
    [0, 0, 0, 0, 0, 0, 2]
];
exports.CSVOutput$ = [3, n0, _CSVO,
    0,
    [_QF, _QEC, _RD, _FD, _QC],
    [0, 0, 0, 0, 0]
];
exports.DefaultRetention$ = [3, n0, _DRe,
    0,
    [_Mo, _D, _Y],
    [0, 1, 1]
];
exports.Delete$ = [3, n0, _De,
    0,
    [_Ob, _Q],
    [[() => ObjectIdentifierList, { [_xF]: 1, [_xN]: _Obj }], 2], 1
];
exports.DeleteBucketAnalyticsConfigurationRequest$ = [3, n0, _DBACR,
    0,
    [_B, _I, _EBO],
    [[0, 1], [0, { [_hQ]: _i }], [0, { [_hH]: _xaebo }]], 2
];
exports.DeleteBucketCorsRequest$ = [3, n0, _DBCR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.DeleteBucketEncryptionRequest$ = [3, n0, _DBER,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.DeleteBucketIntelligentTieringConfigurationRequest$ = [3, n0, _DBITCR,
    0,
    [_B, _I, _EBO],
    [[0, 1], [0, { [_hQ]: _i }], [0, { [_hH]: _xaebo }]], 2
];
exports.DeleteBucketInventoryConfigurationRequest$ = [3, n0, _DBICR,
    0,
    [_B, _I, _EBO],
    [[0, 1], [0, { [_hQ]: _i }], [0, { [_hH]: _xaebo }]], 2
];
exports.DeleteBucketLifecycleRequest$ = [3, n0, _DBLR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.DeleteBucketMetadataConfigurationRequest$ = [3, n0, _DBMCR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.DeleteBucketMetadataTableConfigurationRequest$ = [3, n0, _DBMTCR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.DeleteBucketMetricsConfigurationRequest$ = [3, n0, _DBMCRe,
    0,
    [_B, _I, _EBO],
    [[0, 1], [0, { [_hQ]: _i }], [0, { [_hH]: _xaebo }]], 2
];
exports.DeleteBucketOwnershipControlsRequest$ = [3, n0, _DBOCR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.DeleteBucketPolicyRequest$ = [3, n0, _DBPR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.DeleteBucketReplicationRequest$ = [3, n0, _DBRR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.DeleteBucketRequest$ = [3, n0, _DBR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.DeleteBucketTaggingRequest$ = [3, n0, _DBTR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.DeleteBucketWebsiteRequest$ = [3, n0, _DBWR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.DeletedObject$ = [3, n0, _DO,
    0,
    [_K, _VI, _DM, _DMVI],
    [0, 0, 2, 0]
];
exports.DeleteMarkerEntry$ = [3, n0, _DME,
    0,
    [_O, _K, _VI, _IL, _LM],
    [() => exports.Owner$, 0, 0, 2, 4]
];
exports.DeleteMarkerReplication$ = [3, n0, _DMR,
    0,
    [_S],
    [0]
];
exports.DeleteObjectOutput$ = [3, n0, _DOO,
    0,
    [_DM, _VI, _RC],
    [[2, { [_hH]: _xadm }], [0, { [_hH]: _xavi }], [0, { [_hH]: _xarc }]]
];
exports.DeleteObjectRequest$ = [3, n0, _DOR,
    0,
    [_B, _K, _MFA, _VI, _RP, _BGR, _EBO, _IM, _IMLMT, _IMS],
    [[0, 1], [0, 1], [0, { [_hH]: _xam_ }], [0, { [_hQ]: _vI }], [0, { [_hH]: _xarp }], [2, { [_hH]: _xabgr }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _IM_ }], [6, { [_hH]: _xaimlmt }], [1, { [_hH]: _xaims }]], 2
];
exports.DeleteObjectsOutput$ = [3, n0, _DOOe,
    { [_xN]: _DRel },
    [_Del, _RC, _Er],
    [[() => DeletedObjects, { [_xF]: 1 }], [0, { [_hH]: _xarc }], [() => Errors, { [_xF]: 1, [_xN]: _Err }]]
];
exports.DeleteObjectsRequest$ = [3, n0, _DORe,
    0,
    [_B, _De, _MFA, _RP, _BGR, _EBO, _CA],
    [[0, 1], [() => exports.Delete$, { [_hP]: 1, [_xN]: _De }], [0, { [_hH]: _xam_ }], [0, { [_hH]: _xarp }], [2, { [_hH]: _xabgr }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xasca }]], 2
];
exports.DeleteObjectTaggingOutput$ = [3, n0, _DOTO,
    0,
    [_VI],
    [[0, { [_hH]: _xavi }]]
];
exports.DeleteObjectTaggingRequest$ = [3, n0, _DOTR,
    0,
    [_B, _K, _VI, _EBO],
    [[0, 1], [0, 1], [0, { [_hQ]: _vI }], [0, { [_hH]: _xaebo }]], 2
];
exports.DeletePublicAccessBlockRequest$ = [3, n0, _DPABR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.Destination$ = [3, n0, _Des,
    0,
    [_B, _A, _SC, _ACT, _EC, _RT, _Me],
    [0, 0, 0, () => exports.AccessControlTranslation$, () => exports.EncryptionConfiguration$, () => exports.ReplicationTime$, () => exports.Metrics$], 1
];
exports.DestinationResult$ = [3, n0, _DRes,
    0,
    [_TBT, _TBA, _TN],
    [0, 0, 0]
];
exports.Encryption$ = [3, n0, _En,
    0,
    [_ET, _KMSKI, _KMSC],
    [0, [() => SSEKMSKeyId, 0], 0], 1
];
exports.EncryptionConfiguration$ = [3, n0, _EC,
    0,
    [_RKKID],
    [0]
];
exports.EndEvent$ = [3, n0, _EE,
    0,
    [],
    []
];
exports._Error$ = [3, n0, _Err,
    0,
    [_K, _VI, _Cod, _Mes],
    [0, 0, 0, 0]
];
exports.ErrorDetails$ = [3, n0, _ED,
    0,
    [_ECr, _EM],
    [0, 0]
];
exports.ErrorDocument$ = [3, n0, _EDr,
    0,
    [_K],
    [0], 1
];
exports.EventBridgeConfiguration$ = [3, n0, _EBC,
    0,
    [],
    []
];
exports.ExistingObjectReplication$ = [3, n0, _EOR,
    0,
    [_S],
    [0], 1
];
exports.FilterRule$ = [3, n0, _FR,
    0,
    [_N, _V],
    [0, 0]
];
exports.GetBucketAbacOutput$ = [3, n0, _GBAO,
    0,
    [_AS],
    [[() => exports.AbacStatus$, 16]]
];
exports.GetBucketAbacRequest$ = [3, n0, _GBAR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketAccelerateConfigurationOutput$ = [3, n0, _GBACO,
    { [_xN]: _AC },
    [_S, _RC],
    [0, [0, { [_hH]: _xarc }]]
];
exports.GetBucketAccelerateConfigurationRequest$ = [3, n0, _GBACR,
    0,
    [_B, _EBO, _RP],
    [[0, 1], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xarp }]], 1
];
exports.GetBucketAclOutput$ = [3, n0, _GBAOe,
    { [_xN]: _ACP },
    [_O, _G],
    [() => exports.Owner$, [() => Grants, { [_xN]: _ACL }]]
];
exports.GetBucketAclRequest$ = [3, n0, _GBARe,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketAnalyticsConfigurationOutput$ = [3, n0, _GBACOe,
    0,
    [_ACn],
    [[() => exports.AnalyticsConfiguration$, 16]]
];
exports.GetBucketAnalyticsConfigurationRequest$ = [3, n0, _GBACRe,
    0,
    [_B, _I, _EBO],
    [[0, 1], [0, { [_hQ]: _i }], [0, { [_hH]: _xaebo }]], 2
];
exports.GetBucketCorsOutput$ = [3, n0, _GBCO,
    { [_xN]: _CORSC },
    [_CORSR],
    [[() => CORSRules, { [_xF]: 1, [_xN]: _CORSRu }]]
];
exports.GetBucketCorsRequest$ = [3, n0, _GBCR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketEncryptionOutput$ = [3, n0, _GBEO,
    0,
    [_SSEC],
    [[() => exports.ServerSideEncryptionConfiguration$, 16]]
];
exports.GetBucketEncryptionRequest$ = [3, n0, _GBER,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketIntelligentTieringConfigurationOutput$ = [3, n0, _GBITCO,
    0,
    [_ITC],
    [[() => exports.IntelligentTieringConfiguration$, 16]]
];
exports.GetBucketIntelligentTieringConfigurationRequest$ = [3, n0, _GBITCR,
    0,
    [_B, _I, _EBO],
    [[0, 1], [0, { [_hQ]: _i }], [0, { [_hH]: _xaebo }]], 2
];
exports.GetBucketInventoryConfigurationOutput$ = [3, n0, _GBICO,
    0,
    [_IC],
    [[() => exports.InventoryConfiguration$, 16]]
];
exports.GetBucketInventoryConfigurationRequest$ = [3, n0, _GBICR,
    0,
    [_B, _I, _EBO],
    [[0, 1], [0, { [_hQ]: _i }], [0, { [_hH]: _xaebo }]], 2
];
exports.GetBucketLifecycleConfigurationOutput$ = [3, n0, _GBLCO,
    { [_xN]: _LCi },
    [_R, _TDMOS],
    [[() => LifecycleRules, { [_xF]: 1, [_xN]: _Ru }], [0, { [_hH]: _xatdmos }]]
];
exports.GetBucketLifecycleConfigurationRequest$ = [3, n0, _GBLCR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketLocationOutput$ = [3, n0, _GBLO,
    { [_xN]: _LC },
    [_LC],
    [0]
];
exports.GetBucketLocationRequest$ = [3, n0, _GBLR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketLoggingOutput$ = [3, n0, _GBLOe,
    { [_xN]: _BLS },
    [_LE],
    [[() => exports.LoggingEnabled$, 0]]
];
exports.GetBucketLoggingRequest$ = [3, n0, _GBLRe,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketMetadataConfigurationOutput$ = [3, n0, _GBMCO,
    0,
    [_GBMCR],
    [[() => exports.GetBucketMetadataConfigurationResult$, 16]]
];
exports.GetBucketMetadataConfigurationRequest$ = [3, n0, _GBMCRe,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketMetadataConfigurationResult$ = [3, n0, _GBMCR,
    0,
    [_MCR],
    [() => exports.MetadataConfigurationResult$], 1
];
exports.GetBucketMetadataTableConfigurationOutput$ = [3, n0, _GBMTCO,
    0,
    [_GBMTCR],
    [[() => exports.GetBucketMetadataTableConfigurationResult$, 16]]
];
exports.GetBucketMetadataTableConfigurationRequest$ = [3, n0, _GBMTCRe,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketMetadataTableConfigurationResult$ = [3, n0, _GBMTCR,
    0,
    [_MTCR, _S, _Err],
    [() => exports.MetadataTableConfigurationResult$, 0, () => exports.ErrorDetails$], 2
];
exports.GetBucketMetricsConfigurationOutput$ = [3, n0, _GBMCOe,
    0,
    [_MCe],
    [[() => exports.MetricsConfiguration$, 16]]
];
exports.GetBucketMetricsConfigurationRequest$ = [3, n0, _GBMCRet,
    0,
    [_B, _I, _EBO],
    [[0, 1], [0, { [_hQ]: _i }], [0, { [_hH]: _xaebo }]], 2
];
exports.GetBucketNotificationConfigurationRequest$ = [3, n0, _GBNCR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketOwnershipControlsOutput$ = [3, n0, _GBOCO,
    0,
    [_OC],
    [[() => exports.OwnershipControls$, 16]]
];
exports.GetBucketOwnershipControlsRequest$ = [3, n0, _GBOCR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketPolicyOutput$ = [3, n0, _GBPO,
    0,
    [_Po],
    [[0, 16]]
];
exports.GetBucketPolicyRequest$ = [3, n0, _GBPR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketPolicyStatusOutput$ = [3, n0, _GBPSO,
    0,
    [_PS],
    [[() => exports.PolicyStatus$, 16]]
];
exports.GetBucketPolicyStatusRequest$ = [3, n0, _GBPSR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketReplicationOutput$ = [3, n0, _GBRO,
    0,
    [_RCe],
    [[() => exports.ReplicationConfiguration$, 16]]
];
exports.GetBucketReplicationRequest$ = [3, n0, _GBRR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketRequestPaymentOutput$ = [3, n0, _GBRPO,
    { [_xN]: _RPC },
    [_Pay],
    [0]
];
exports.GetBucketRequestPaymentRequest$ = [3, n0, _GBRPR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketTaggingOutput$ = [3, n0, _GBTO,
    { [_xN]: _Tag },
    [_TS],
    [[() => TagSet, 0]], 1
];
exports.GetBucketTaggingRequest$ = [3, n0, _GBTR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketVersioningOutput$ = [3, n0, _GBVO,
    { [_xN]: _VC },
    [_S, _MFAD],
    [0, [0, { [_xN]: _MDf }]]
];
exports.GetBucketVersioningRequest$ = [3, n0, _GBVR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetBucketWebsiteOutput$ = [3, n0, _GBWO,
    { [_xN]: _WC },
    [_RART, _IDn, _EDr, _RR],
    [() => exports.RedirectAllRequestsTo$, () => exports.IndexDocument$, () => exports.ErrorDocument$, [() => RoutingRules, 0]]
];
exports.GetBucketWebsiteRequest$ = [3, n0, _GBWR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetObjectAclOutput$ = [3, n0, _GOAO,
    { [_xN]: _ACP },
    [_O, _G, _RC],
    [() => exports.Owner$, [() => Grants, { [_xN]: _ACL }], [0, { [_hH]: _xarc }]]
];
exports.GetObjectAclRequest$ = [3, n0, _GOAR,
    0,
    [_B, _K, _VI, _RP, _EBO],
    [[0, 1], [0, 1], [0, { [_hQ]: _vI }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xaebo }]], 2
];
exports.GetObjectAttributesOutput$ = [3, n0, _GOAOe,
    { [_xN]: _GOARe },
    [_DM, _LM, _VI, _RC, _ETa, _C, _OP, _SC, _OS],
    [[2, { [_hH]: _xadm }], [4, { [_hH]: _LM_ }], [0, { [_hH]: _xavi }], [0, { [_hH]: _xarc }], 0, () => exports.Checksum$, [() => exports.GetObjectAttributesParts$, 0], 0, 1]
];
exports.GetObjectAttributesParts$ = [3, n0, _GOAP,
    0,
    [_TPC, _PNM, _NPNM, _MP, _IT, _Pa],
    [[1, { [_xN]: _PC }], 0, 0, 1, 2, [() => PartsList, { [_xF]: 1, [_xN]: _Par }]]
];
exports.GetObjectAttributesRequest$ = [3, n0, _GOARet,
    0,
    [_B, _K, _OA, _VI, _MP, _PNM, _SSECA, _SSECK, _SSECKMD, _RP, _EBO],
    [[0, 1], [0, 1], [64 | 0, { [_hH]: _xaoa }], [0, { [_hQ]: _vI }], [1, { [_hH]: _xamp }], [0, { [_hH]: _xapnm }], [0, { [_hH]: _xasseca }], [() => SSECustomerKey, { [_hH]: _xasseck }], [0, { [_hH]: _xasseckM }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xaebo }]], 3
];
exports.GetObjectLegalHoldOutput$ = [3, n0, _GOLHO,
    0,
    [_LH],
    [[() => exports.ObjectLockLegalHold$, { [_hP]: 1, [_xN]: _LH }]]
];
exports.GetObjectLegalHoldRequest$ = [3, n0, _GOLHR,
    0,
    [_B, _K, _VI, _RP, _EBO],
    [[0, 1], [0, 1], [0, { [_hQ]: _vI }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xaebo }]], 2
];
exports.GetObjectLockConfigurationOutput$ = [3, n0, _GOLCO,
    0,
    [_OLC],
    [[() => exports.ObjectLockConfiguration$, 16]]
];
exports.GetObjectLockConfigurationRequest$ = [3, n0, _GOLCR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GetObjectOutput$ = [3, n0, _GOO,
    0,
    [_Bo, _DM, _AR, _E, _Re, _LM, _CLo, _ETa, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh, _CT, _MM, _VI, _CC, _CDo, _CEo, _CL, _CR, _CTo, _Ex, _ES, _WRL, _SSE, _M, _SSECA, _SSECKMD, _SSEKMSKI, _BKE, _SC, _RC, _RS, _PC, _TC, _OLM, _OLRUD, _OLLHS],
    [[() => StreamingBlob, 16], [2, { [_hH]: _xadm }], [0, { [_hH]: _ar }], [0, { [_hH]: _xae }], [0, { [_hH]: _xar }], [4, { [_hH]: _LM_ }], [1, { [_hH]: _CL__ }], [0, { [_hH]: _ETa }], [0, { [_hH]: _xacc }], [0, { [_hH]: _xacc_ }], [0, { [_hH]: _xacc__ }], [0, { [_hH]: _xacs }], [0, { [_hH]: _xacs_ }], [0, { [_hH]: _xact }], [1, { [_hH]: _xamm }], [0, { [_hH]: _xavi }], [0, { [_hH]: _CC_ }], [0, { [_hH]: _CD_ }], [0, { [_hH]: _CE_ }], [0, { [_hH]: _CL_ }], [0, { [_hH]: _CR_ }], [0, { [_hH]: _CT_ }], [4, { [_hH]: _Ex }], [0, { [_hH]: _ES }], [0, { [_hH]: _xawrl }], [0, { [_hH]: _xasse }], [128 | 0, { [_hPH]: _xam }], [0, { [_hH]: _xasseca }], [0, { [_hH]: _xasseckM }], [() => SSEKMSKeyId, { [_hH]: _xasseakki }], [2, { [_hH]: _xassebke }], [0, { [_hH]: _xasc }], [0, { [_hH]: _xarc }], [0, { [_hH]: _xars }], [1, { [_hH]: _xampc }], [1, { [_hH]: _xatc }], [0, { [_hH]: _xaolm }], [5, { [_hH]: _xaolrud }], [0, { [_hH]: _xaollh }]]
];
exports.GetObjectRequest$ = [3, n0, _GOR,
    0,
    [_B, _K, _IM, _IMSf, _INM, _IUS, _Ra, _RCC, _RCD, _RCE, _RCL, _RCT, _RE, _VI, _SSECA, _SSECK, _SSECKMD, _RP, _PN, _EBO, _CMh],
    [[0, 1], [0, 1], [0, { [_hH]: _IM_ }], [4, { [_hH]: _IMS_ }], [0, { [_hH]: _INM_ }], [4, { [_hH]: _IUS_ }], [0, { [_hH]: _Ra }], [0, { [_hQ]: _rcc }], [0, { [_hQ]: _rcd }], [0, { [_hQ]: _rce }], [0, { [_hQ]: _rcl }], [0, { [_hQ]: _rct }], [6, { [_hQ]: _re }], [0, { [_hQ]: _vI }], [0, { [_hH]: _xasseca }], [() => SSECustomerKey, { [_hH]: _xasseck }], [0, { [_hH]: _xasseckM }], [0, { [_hH]: _xarp }], [1, { [_hQ]: _pN }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xacm }]], 2
];
exports.GetObjectRetentionOutput$ = [3, n0, _GORO,
    0,
    [_Ret],
    [[() => exports.ObjectLockRetention$, { [_hP]: 1, [_xN]: _Ret }]]
];
exports.GetObjectRetentionRequest$ = [3, n0, _GORR,
    0,
    [_B, _K, _VI, _RP, _EBO],
    [[0, 1], [0, 1], [0, { [_hQ]: _vI }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xaebo }]], 2
];
exports.GetObjectTaggingOutput$ = [3, n0, _GOTO,
    { [_xN]: _Tag },
    [_TS, _VI],
    [[() => TagSet, 0], [0, { [_hH]: _xavi }]], 1
];
exports.GetObjectTaggingRequest$ = [3, n0, _GOTR,
    0,
    [_B, _K, _VI, _EBO, _RP],
    [[0, 1], [0, 1], [0, { [_hQ]: _vI }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xarp }]], 2
];
exports.GetObjectTorrentOutput$ = [3, n0, _GOTOe,
    0,
    [_Bo, _RC],
    [[() => StreamingBlob, 16], [0, { [_hH]: _xarc }]]
];
exports.GetObjectTorrentRequest$ = [3, n0, _GOTRe,
    0,
    [_B, _K, _RP, _EBO],
    [[0, 1], [0, 1], [0, { [_hH]: _xarp }], [0, { [_hH]: _xaebo }]], 2
];
exports.GetPublicAccessBlockOutput$ = [3, n0, _GPABO,
    0,
    [_PABC],
    [[() => exports.PublicAccessBlockConfiguration$, 16]]
];
exports.GetPublicAccessBlockRequest$ = [3, n0, _GPABR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.GlacierJobParameters$ = [3, n0, _GJP,
    0,
    [_Ti],
    [0], 1
];
exports.Grant$ = [3, n0, _Gr,
    0,
    [_Gra, _Pe],
    [[() => exports.Grantee$, { [_xNm]: [_x, _hi] }], 0]
];
exports.Grantee$ = [3, n0, _Gra,
    0,
    [_Ty, _DN, _EA, _ID, _URI],
    [[0, { [_xA]: 1, [_xN]: _xs }], 0, 0, 0, 0], 1
];
exports.HeadBucketOutput$ = [3, n0, _HBO,
    0,
    [_BA, _BLT, _BLN, _BR, _APA],
    [[0, { [_hH]: _xaba }], [0, { [_hH]: _xablt }], [0, { [_hH]: _xabln }], [0, { [_hH]: _xabr }], [2, { [_hH]: _xaapa }]]
];
exports.HeadBucketRequest$ = [3, n0, _HBR,
    0,
    [_B, _EBO],
    [[0, 1], [0, { [_hH]: _xaebo }]], 1
];
exports.HeadObjectOutput$ = [3, n0, _HOO,
    0,
    [_DM, _AR, _E, _Re, _ASr, _LM, _CLo, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh, _CT, _ETa, _MM, _VI, _CC, _CDo, _CEo, _CL, _CTo, _CR, _Ex, _ES, _WRL, _SSE, _M, _SSECA, _SSECKMD, _SSEKMSKI, _BKE, _SC, _RC, _RS, _PC, _TC, _OLM, _OLRUD, _OLLHS],
    [[2, { [_hH]: _xadm }], [0, { [_hH]: _ar }], [0, { [_hH]: _xae }], [0, { [_hH]: _xar }], [0, { [_hH]: _xaas }], [4, { [_hH]: _LM_ }], [1, { [_hH]: _CL__ }], [0, { [_hH]: _xacc }], [0, { [_hH]: _xacc_ }], [0, { [_hH]: _xacc__ }], [0, { [_hH]: _xacs }], [0, { [_hH]: _xacs_ }], [0, { [_hH]: _xact }], [0, { [_hH]: _ETa }], [1, { [_hH]: _xamm }], [0, { [_hH]: _xavi }], [0, { [_hH]: _CC_ }], [0, { [_hH]: _CD_ }], [0, { [_hH]: _CE_ }], [0, { [_hH]: _CL_ }], [0, { [_hH]: _CT_ }], [0, { [_hH]: _CR_ }], [4, { [_hH]: _Ex }], [0, { [_hH]: _ES }], [0, { [_hH]: _xawrl }], [0, { [_hH]: _xasse }], [128 | 0, { [_hPH]: _xam }], [0, { [_hH]: _xasseca }], [0, { [_hH]: _xasseckM }], [() => SSEKMSKeyId, { [_hH]: _xasseakki }], [2, { [_hH]: _xassebke }], [0, { [_hH]: _xasc }], [0, { [_hH]: _xarc }], [0, { [_hH]: _xars }], [1, { [_hH]: _xampc }], [1, { [_hH]: _xatc }], [0, { [_hH]: _xaolm }], [5, { [_hH]: _xaolrud }], [0, { [_hH]: _xaollh }]]
];
exports.HeadObjectRequest$ = [3, n0, _HOR,
    0,
    [_B, _K, _IM, _IMSf, _INM, _IUS, _Ra, _RCC, _RCD, _RCE, _RCL, _RCT, _RE, _VI, _SSECA, _SSECK, _SSECKMD, _RP, _PN, _EBO, _CMh],
    [[0, 1], [0, 1], [0, { [_hH]: _IM_ }], [4, { [_hH]: _IMS_ }], [0, { [_hH]: _INM_ }], [4, { [_hH]: _IUS_ }], [0, { [_hH]: _Ra }], [0, { [_hQ]: _rcc }], [0, { [_hQ]: _rcd }], [0, { [_hQ]: _rce }], [0, { [_hQ]: _rcl }], [0, { [_hQ]: _rct }], [6, { [_hQ]: _re }], [0, { [_hQ]: _vI }], [0, { [_hH]: _xasseca }], [() => SSECustomerKey, { [_hH]: _xasseck }], [0, { [_hH]: _xasseckM }], [0, { [_hH]: _xarp }], [1, { [_hQ]: _pN }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xacm }]], 2
];
exports.IndexDocument$ = [3, n0, _IDn,
    0,
    [_Su],
    [0], 1
];
exports.Initiator$ = [3, n0, _In,
    0,
    [_ID, _DN],
    [0, 0]
];
exports.InputSerialization$ = [3, n0, _IS,
    0,
    [_CSV, _CTom, _JSON, _Parq],
    [() => exports.CSVInput$, 0, () => exports.JSONInput$, () => exports.ParquetInput$]
];
exports.IntelligentTieringAndOperator$ = [3, n0, _ITAO,
    0,
    [_P, _T],
    [0, [() => TagSet, { [_xF]: 1, [_xN]: _Ta }]]
];
exports.IntelligentTieringConfiguration$ = [3, n0, _ITC,
    0,
    [_I, _S, _Tie, _F],
    [0, 0, [() => TieringList, { [_xF]: 1, [_xN]: _Tier }], [() => exports.IntelligentTieringFilter$, 0]], 3
];
exports.IntelligentTieringFilter$ = [3, n0, _ITF,
    0,
    [_P, _Ta, _An],
    [0, () => exports.Tag$, [() => exports.IntelligentTieringAndOperator$, 0]]
];
exports.InventoryConfiguration$ = [3, n0, _IC,
    0,
    [_Des, _IE, _I, _IOV, _Sc, _F, _OF],
    [[() => exports.InventoryDestination$, 0], 2, 0, 0, () => exports.InventorySchedule$, () => exports.InventoryFilter$, [() => InventoryOptionalFields, 0]], 5
];
exports.InventoryDestination$ = [3, n0, _IDnv,
    0,
    [_SBD],
    [[() => exports.InventoryS3BucketDestination$, 0]], 1
];
exports.InventoryEncryption$ = [3, n0, _IEn,
    0,
    [_SSES, _SSEKMS],
    [[() => exports.SSES3$, { [_xN]: _SS }], [() => exports.SSEKMS$, { [_xN]: _SK }]]
];
exports.InventoryFilter$ = [3, n0, _IF,
    0,
    [_P],
    [0], 1
];
exports.InventoryS3BucketDestination$ = [3, n0, _ISBD,
    0,
    [_B, _Fo, _AI, _P, _En],
    [0, 0, 0, 0, [() => exports.InventoryEncryption$, 0]], 2
];
exports.InventorySchedule$ = [3, n0, _ISn,
    0,
    [_Fr],
    [0], 1
];
exports.InventoryTableConfiguration$ = [3, n0, _ITCn,
    0,
    [_CSo, _EC],
    [0, () => exports.MetadataTableEncryptionConfiguration$], 1
];
exports.InventoryTableConfigurationResult$ = [3, n0, _ITCR,
    0,
    [_CSo, _TSa, _Err, _TNa, _TA],
    [0, 0, () => exports.ErrorDetails$, 0, 0], 1
];
exports.InventoryTableConfigurationUpdates$ = [3, n0, _ITCU,
    0,
    [_CSo, _EC],
    [0, () => exports.MetadataTableEncryptionConfiguration$], 1
];
exports.JournalTableConfiguration$ = [3, n0, _JTC,
    0,
    [_REe, _EC],
    [() => exports.RecordExpiration$, () => exports.MetadataTableEncryptionConfiguration$], 1
];
exports.JournalTableConfigurationResult$ = [3, n0, _JTCR,
    0,
    [_TSa, _TNa, _REe, _Err, _TA],
    [0, 0, () => exports.RecordExpiration$, () => exports.ErrorDetails$, 0], 3
];
exports.JournalTableConfigurationUpdates$ = [3, n0, _JTCU,
    0,
    [_REe],
    [() => exports.RecordExpiration$], 1
];
exports.JSONInput$ = [3, n0, _JSONI,
    0,
    [_Ty],
    [0]
];
exports.JSONOutput$ = [3, n0, _JSONO,
    0,
    [_RD],
    [0]
];
exports.LambdaFunctionConfiguration$ = [3, n0, _LFC,
    0,
    [_LFA, _Ev, _I, _F],
    [[0, { [_xN]: _CF }], [64 | 0, { [_xF]: 1, [_xN]: _Eve }], 0, [() => exports.NotificationConfigurationFilter$, 0]], 2
];
exports.LifecycleExpiration$ = [3, n0, _LEi,
    0,
    [_Da, _D, _EODM],
    [5, 1, 2]
];
exports.LifecycleRule$ = [3, n0, _LR,
    0,
    [_S, _E, _ID, _P, _F, _Tr, _NVT, _NVE, _AIMU],
    [0, () => exports.LifecycleExpiration$, 0, 0, [() => exports.LifecycleRuleFilter$, 0], [() => TransitionList, { [_xF]: 1, [_xN]: _Tra }], [() => NoncurrentVersionTransitionList, { [_xF]: 1, [_xN]: _NVTo }], () => exports.NoncurrentVersionExpiration$, () => exports.AbortIncompleteMultipartUpload$], 1
];
exports.LifecycleRuleAndOperator$ = [3, n0, _LRAO,
    0,
    [_P, _T, _OSGT, _OSLT],
    [0, [() => TagSet, { [_xF]: 1, [_xN]: _Ta }], 1, 1]
];
exports.LifecycleRuleFilter$ = [3, n0, _LRF,
    0,
    [_P, _Ta, _OSGT, _OSLT, _An],
    [0, () => exports.Tag$, 1, 1, [() => exports.LifecycleRuleAndOperator$, 0]]
];
exports.ListBucketAnalyticsConfigurationsOutput$ = [3, n0, _LBACO,
    { [_xN]: _LBACR },
    [_IT, _CTon, _NCT, _ACLn],
    [2, 0, 0, [() => AnalyticsConfigurationList, { [_xF]: 1, [_xN]: _ACn }]]
];
exports.ListBucketAnalyticsConfigurationsRequest$ = [3, n0, _LBACRi,
    0,
    [_B, _CTon, _EBO],
    [[0, 1], [0, { [_hQ]: _ct }], [0, { [_hH]: _xaebo }]], 1
];
exports.ListBucketIntelligentTieringConfigurationsOutput$ = [3, n0, _LBITCO,
    0,
    [_IT, _CTon, _NCT, _ITCL],
    [2, 0, 0, [() => IntelligentTieringConfigurationList, { [_xF]: 1, [_xN]: _ITC }]]
];
exports.ListBucketIntelligentTieringConfigurationsRequest$ = [3, n0, _LBITCR,
    0,
    [_B, _CTon, _EBO],
    [[0, 1], [0, { [_hQ]: _ct }], [0, { [_hH]: _xaebo }]], 1
];
exports.ListBucketInventoryConfigurationsOutput$ = [3, n0, _LBICO,
    { [_xN]: _LICR },
    [_CTon, _ICL, _IT, _NCT],
    [0, [() => InventoryConfigurationList, { [_xF]: 1, [_xN]: _IC }], 2, 0]
];
exports.ListBucketInventoryConfigurationsRequest$ = [3, n0, _LBICR,
    0,
    [_B, _CTon, _EBO],
    [[0, 1], [0, { [_hQ]: _ct }], [0, { [_hH]: _xaebo }]], 1
];
exports.ListBucketMetricsConfigurationsOutput$ = [3, n0, _LBMCO,
    { [_xN]: _LMCR },
    [_IT, _CTon, _NCT, _MCL],
    [2, 0, 0, [() => MetricsConfigurationList, { [_xF]: 1, [_xN]: _MCe }]]
];
exports.ListBucketMetricsConfigurationsRequest$ = [3, n0, _LBMCR,
    0,
    [_B, _CTon, _EBO],
    [[0, 1], [0, { [_hQ]: _ct }], [0, { [_hH]: _xaebo }]], 1
];
exports.ListBucketsOutput$ = [3, n0, _LBO,
    { [_xN]: _LAMBR },
    [_Bu, _O, _CTon, _P],
    [[() => Buckets, 0], () => exports.Owner$, 0, 0]
];
exports.ListBucketsRequest$ = [3, n0, _LBR,
    0,
    [_MB, _CTon, _P, _BR],
    [[1, { [_hQ]: _mb }], [0, { [_hQ]: _ct }], [0, { [_hQ]: _p }], [0, { [_hQ]: _br }]]
];
exports.ListDirectoryBucketsOutput$ = [3, n0, _LDBO,
    { [_xN]: _LAMDBR },
    [_Bu, _CTon],
    [[() => Buckets, 0], 0]
];
exports.ListDirectoryBucketsRequest$ = [3, n0, _LDBR,
    0,
    [_CTon, _MDB],
    [[0, { [_hQ]: _ct }], [1, { [_hQ]: _mdb }]]
];
exports.ListMultipartUploadsOutput$ = [3, n0, _LMUO,
    { [_xN]: _LMUR },
    [_B, _KM, _UIM, _NKM, _P, _Deli, _NUIM, _MUa, _IT, _U, _CPom, _ETn, _RC],
    [0, 0, 0, 0, 0, 0, 0, 1, 2, [() => MultipartUploadList, { [_xF]: 1, [_xN]: _Up }], [() => CommonPrefixList, { [_xF]: 1 }], 0, [0, { [_hH]: _xarc }]]
];
exports.ListMultipartUploadsRequest$ = [3, n0, _LMURi,
    0,
    [_B, _Deli, _ETn, _KM, _MUa, _P, _UIM, _EBO, _RP],
    [[0, 1], [0, { [_hQ]: _d }], [0, { [_hQ]: _et }], [0, { [_hQ]: _km }], [1, { [_hQ]: _mu }], [0, { [_hQ]: _p }], [0, { [_hQ]: _uim }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xarp }]], 1
];
exports.ListObjectsOutput$ = [3, n0, _LOO,
    { [_xN]: _LBRi },
    [_IT, _Ma, _NM, _Con, _N, _P, _Deli, _MK, _CPom, _ETn, _RC],
    [2, 0, 0, [() => ObjectList, { [_xF]: 1 }], 0, 0, 0, 1, [() => CommonPrefixList, { [_xF]: 1 }], 0, [0, { [_hH]: _xarc }]]
];
exports.ListObjectsRequest$ = [3, n0, _LOR,
    0,
    [_B, _Deli, _ETn, _Ma, _MK, _P, _RP, _EBO, _OOA],
    [[0, 1], [0, { [_hQ]: _d }], [0, { [_hQ]: _et }], [0, { [_hQ]: _m }], [1, { [_hQ]: _mk }], [0, { [_hQ]: _p }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xaebo }], [64 | 0, { [_hH]: _xaooa }]], 1
];
exports.ListObjectsV2Output$ = [3, n0, _LOVO,
    { [_xN]: _LBRi },
    [_IT, _Con, _N, _P, _Deli, _MK, _CPom, _ETn, _KC, _CTon, _NCT, _SA, _RC],
    [2, [() => ObjectList, { [_xF]: 1 }], 0, 0, 0, 1, [() => CommonPrefixList, { [_xF]: 1 }], 0, 1, 0, 0, 0, [0, { [_hH]: _xarc }]]
];
exports.ListObjectsV2Request$ = [3, n0, _LOVR,
    0,
    [_B, _Deli, _ETn, _MK, _P, _CTon, _FO, _SA, _RP, _EBO, _OOA],
    [[0, 1], [0, { [_hQ]: _d }], [0, { [_hQ]: _et }], [1, { [_hQ]: _mk }], [0, { [_hQ]: _p }], [0, { [_hQ]: _ct }], [2, { [_hQ]: _fo }], [0, { [_hQ]: _sa }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xaebo }], [64 | 0, { [_hH]: _xaooa }]], 1
];
exports.ListObjectVersionsOutput$ = [3, n0, _LOVOi,
    { [_xN]: _LVR },
    [_IT, _KM, _VIM, _NKM, _NVIM, _Ve, _DMe, _N, _P, _Deli, _MK, _CPom, _ETn, _RC],
    [2, 0, 0, 0, 0, [() => ObjectVersionList, { [_xF]: 1, [_xN]: _Ver }], [() => DeleteMarkers, { [_xF]: 1, [_xN]: _DM }], 0, 0, 0, 1, [() => CommonPrefixList, { [_xF]: 1 }], 0, [0, { [_hH]: _xarc }]]
];
exports.ListObjectVersionsRequest$ = [3, n0, _LOVRi,
    0,
    [_B, _Deli, _ETn, _KM, _MK, _P, _VIM, _EBO, _RP, _OOA],
    [[0, 1], [0, { [_hQ]: _d }], [0, { [_hQ]: _et }], [0, { [_hQ]: _km }], [1, { [_hQ]: _mk }], [0, { [_hQ]: _p }], [0, { [_hQ]: _vim }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xarp }], [64 | 0, { [_hH]: _xaooa }]], 1
];
exports.ListPartsOutput$ = [3, n0, _LPO,
    { [_xN]: _LPR },
    [_ADb, _ARI, _B, _K, _UI, _PNM, _NPNM, _MP, _IT, _Pa, _In, _O, _SC, _RC, _CA, _CT],
    [[4, { [_hH]: _xaad }], [0, { [_hH]: _xaari }], 0, 0, 0, 0, 0, 1, 2, [() => Parts, { [_xF]: 1, [_xN]: _Par }], () => exports.Initiator$, () => exports.Owner$, 0, [0, { [_hH]: _xarc }], 0, 0]
];
exports.ListPartsRequest$ = [3, n0, _LPRi,
    0,
    [_B, _K, _UI, _MP, _PNM, _RP, _EBO, _SSECA, _SSECK, _SSECKMD],
    [[0, 1], [0, 1], [0, { [_hQ]: _uI }], [1, { [_hQ]: _mp }], [0, { [_hQ]: _pnm }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xasseca }], [() => SSECustomerKey, { [_hH]: _xasseck }], [0, { [_hH]: _xasseckM }]], 3
];
exports.LocationInfo$ = [3, n0, _LI,
    0,
    [_Ty, _N],
    [0, 0]
];
exports.LoggingEnabled$ = [3, n0, _LE,
    0,
    [_TB, _TP, _TG, _TOKF],
    [0, 0, [() => TargetGrants, 0], [() => exports.TargetObjectKeyFormat$, 0]], 2
];
exports.MetadataConfiguration$ = [3, n0, _MC,
    0,
    [_JTC, _ITCn],
    [() => exports.JournalTableConfiguration$, () => exports.InventoryTableConfiguration$], 1
];
exports.MetadataConfigurationResult$ = [3, n0, _MCR,
    0,
    [_DRes, _JTCR, _ITCR],
    [() => exports.DestinationResult$, () => exports.JournalTableConfigurationResult$, () => exports.InventoryTableConfigurationResult$], 1
];
exports.MetadataEntry$ = [3, n0, _ME,
    0,
    [_N, _V],
    [0, 0]
];
exports.MetadataTableConfiguration$ = [3, n0, _MTC,
    0,
    [_STD],
    [() => exports.S3TablesDestination$], 1
];
exports.MetadataTableConfigurationResult$ = [3, n0, _MTCR,
    0,
    [_STDR],
    [() => exports.S3TablesDestinationResult$], 1
];
exports.MetadataTableEncryptionConfiguration$ = [3, n0, _MTEC,
    0,
    [_SAs, _KKA],
    [0, 0], 1
];
exports.Metrics$ = [3, n0, _Me,
    0,
    [_S, _ETv],
    [0, () => exports.ReplicationTimeValue$], 1
];
exports.MetricsAndOperator$ = [3, n0, _MAO,
    0,
    [_P, _T, _APAc],
    [0, [() => TagSet, { [_xF]: 1, [_xN]: _Ta }], 0]
];
exports.MetricsConfiguration$ = [3, n0, _MCe,
    0,
    [_I, _F],
    [0, [() => exports.MetricsFilter$, 0]], 1
];
exports.MultipartUpload$ = [3, n0, _MU,
    0,
    [_UI, _K, _Ini, _SC, _O, _In, _CA, _CT],
    [0, 0, 4, 0, () => exports.Owner$, () => exports.Initiator$, 0, 0]
];
exports.NoncurrentVersionExpiration$ = [3, n0, _NVE,
    0,
    [_ND, _NNV],
    [1, 1]
];
exports.NoncurrentVersionTransition$ = [3, n0, _NVTo,
    0,
    [_ND, _SC, _NNV],
    [1, 0, 1]
];
exports.NotificationConfiguration$ = [3, n0, _NC,
    0,
    [_TCo, _QCu, _LFCa, _EBC],
    [[() => TopicConfigurationList, { [_xF]: 1, [_xN]: _TCop }], [() => QueueConfigurationList, { [_xF]: 1, [_xN]: _QCue }], [() => LambdaFunctionConfigurationList, { [_xF]: 1, [_xN]: _CFC }], () => exports.EventBridgeConfiguration$]
];
exports.NotificationConfigurationFilter$ = [3, n0, _NCF,
    0,
    [_K],
    [[() => exports.S3KeyFilter$, { [_xN]: _SKe }]]
];
exports._Object$ = [3, n0, _Obj,
    0,
    [_K, _LM, _ETa, _CA, _CT, _Si, _SC, _O, _RSe],
    [0, 4, 0, [64 | 0, { [_xF]: 1 }], 0, 1, 0, () => exports.Owner$, () => exports.RestoreStatus$]
];
exports.ObjectIdentifier$ = [3, n0, _OI,
    0,
    [_K, _VI, _ETa, _LMT, _Si],
    [0, 0, 0, 6, 1], 1
];
exports.ObjectLockConfiguration$ = [3, n0, _OLC,
    0,
    [_OLE, _Ru],
    [0, () => exports.ObjectLockRule$]
];
exports.ObjectLockLegalHold$ = [3, n0, _OLLH,
    0,
    [_S],
    [0]
];
exports.ObjectLockRetention$ = [3, n0, _OLR,
    0,
    [_Mo, _RUD],
    [0, 5]
];
exports.ObjectLockRule$ = [3, n0, _OLRb,
    0,
    [_DRe],
    [() => exports.DefaultRetention$]
];
exports.ObjectPart$ = [3, n0, _OPb,
    0,
    [_PN, _Si, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh],
    [1, 1, 0, 0, 0, 0, 0]
];
exports.ObjectVersion$ = [3, n0, _OV,
    0,
    [_ETa, _CA, _CT, _Si, _SC, _K, _VI, _IL, _LM, _O, _RSe],
    [0, [64 | 0, { [_xF]: 1 }], 0, 1, 0, 0, 0, 2, 4, () => exports.Owner$, () => exports.RestoreStatus$]
];
exports.OutputLocation$ = [3, n0, _OL,
    0,
    [_S_],
    [[() => exports.S3Location$, 0]]
];
exports.OutputSerialization$ = [3, n0, _OSu,
    0,
    [_CSV, _JSON],
    [() => exports.CSVOutput$, () => exports.JSONOutput$]
];
exports.Owner$ = [3, n0, _O,
    0,
    [_DN, _ID],
    [0, 0]
];
exports.OwnershipControls$ = [3, n0, _OC,
    0,
    [_R],
    [[() => OwnershipControlsRules, { [_xF]: 1, [_xN]: _Ru }]], 1
];
exports.OwnershipControlsRule$ = [3, n0, _OCR,
    0,
    [_OO],
    [0], 1
];
exports.ParquetInput$ = [3, n0, _PI,
    0,
    [],
    []
];
exports.Part$ = [3, n0, _Par,
    0,
    [_PN, _LM, _ETa, _Si, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh],
    [1, 4, 0, 1, 0, 0, 0, 0, 0]
];
exports.PartitionedPrefix$ = [3, n0, _PP,
    { [_xN]: _PP },
    [_PDS],
    [0]
];
exports.PolicyStatus$ = [3, n0, _PS,
    0,
    [_IP],
    [[2, { [_xN]: _IP }]]
];
exports.Progress$ = [3, n0, _Pr,
    0,
    [_BS, _BP, _BRy],
    [1, 1, 1]
];
exports.ProgressEvent$ = [3, n0, _PE,
    0,
    [_Det],
    [[() => exports.Progress$, { [_eP]: 1 }]]
];
exports.PublicAccessBlockConfiguration$ = [3, n0, _PABC,
    0,
    [_BPA, _IPA, _BPP, _RPB],
    [[2, { [_xN]: _BPA }], [2, { [_xN]: _IPA }], [2, { [_xN]: _BPP }], [2, { [_xN]: _RPB }]]
];
exports.PutBucketAbacRequest$ = [3, n0, _PBAR,
    0,
    [_B, _AS, _CMD, _CA, _EBO],
    [[0, 1], [() => exports.AbacStatus$, { [_hP]: 1, [_xN]: _AS }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutBucketAccelerateConfigurationRequest$ = [3, n0, _PBACR,
    0,
    [_B, _AC, _EBO, _CA],
    [[0, 1], [() => exports.AccelerateConfiguration$, { [_hP]: 1, [_xN]: _AC }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xasca }]], 2
];
exports.PutBucketAclRequest$ = [3, n0, _PBARu,
    0,
    [_B, _ACL_, _ACP, _CMD, _CA, _GFC, _GR, _GRACP, _GW, _GWACP, _EBO],
    [[0, 1], [0, { [_hH]: _xaa }], [() => exports.AccessControlPolicy$, { [_hP]: 1, [_xN]: _ACP }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xagfc }], [0, { [_hH]: _xagr }], [0, { [_hH]: _xagra }], [0, { [_hH]: _xagw }], [0, { [_hH]: _xagwa }], [0, { [_hH]: _xaebo }]], 1
];
exports.PutBucketAnalyticsConfigurationRequest$ = [3, n0, _PBACRu,
    0,
    [_B, _I, _ACn, _EBO],
    [[0, 1], [0, { [_hQ]: _i }], [() => exports.AnalyticsConfiguration$, { [_hP]: 1, [_xN]: _ACn }], [0, { [_hH]: _xaebo }]], 3
];
exports.PutBucketCorsRequest$ = [3, n0, _PBCR,
    0,
    [_B, _CORSC, _CMD, _CA, _EBO],
    [[0, 1], [() => exports.CORSConfiguration$, { [_hP]: 1, [_xN]: _CORSC }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutBucketEncryptionRequest$ = [3, n0, _PBER,
    0,
    [_B, _SSEC, _CMD, _CA, _EBO],
    [[0, 1], [() => exports.ServerSideEncryptionConfiguration$, { [_hP]: 1, [_xN]: _SSEC }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutBucketIntelligentTieringConfigurationRequest$ = [3, n0, _PBITCR,
    0,
    [_B, _I, _ITC, _EBO],
    [[0, 1], [0, { [_hQ]: _i }], [() => exports.IntelligentTieringConfiguration$, { [_hP]: 1, [_xN]: _ITC }], [0, { [_hH]: _xaebo }]], 3
];
exports.PutBucketInventoryConfigurationRequest$ = [3, n0, _PBICR,
    0,
    [_B, _I, _IC, _EBO],
    [[0, 1], [0, { [_hQ]: _i }], [() => exports.InventoryConfiguration$, { [_hP]: 1, [_xN]: _IC }], [0, { [_hH]: _xaebo }]], 3
];
exports.PutBucketLifecycleConfigurationOutput$ = [3, n0, _PBLCO,
    0,
    [_TDMOS],
    [[0, { [_hH]: _xatdmos }]]
];
exports.PutBucketLifecycleConfigurationRequest$ = [3, n0, _PBLCR,
    0,
    [_B, _CA, _LCi, _EBO, _TDMOS],
    [[0, 1], [0, { [_hH]: _xasca }], [() => exports.BucketLifecycleConfiguration$, { [_hP]: 1, [_xN]: _LCi }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xatdmos }]], 1
];
exports.PutBucketLoggingRequest$ = [3, n0, _PBLR,
    0,
    [_B, _BLS, _CMD, _CA, _EBO],
    [[0, 1], [() => exports.BucketLoggingStatus$, { [_hP]: 1, [_xN]: _BLS }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutBucketMetricsConfigurationRequest$ = [3, n0, _PBMCR,
    0,
    [_B, _I, _MCe, _EBO],
    [[0, 1], [0, { [_hQ]: _i }], [() => exports.MetricsConfiguration$, { [_hP]: 1, [_xN]: _MCe }], [0, { [_hH]: _xaebo }]], 3
];
exports.PutBucketNotificationConfigurationRequest$ = [3, n0, _PBNCR,
    0,
    [_B, _NC, _EBO, _SDV],
    [[0, 1], [() => exports.NotificationConfiguration$, { [_hP]: 1, [_xN]: _NC }], [0, { [_hH]: _xaebo }], [2, { [_hH]: _xasdv }]], 2
];
exports.PutBucketOwnershipControlsRequest$ = [3, n0, _PBOCR,
    0,
    [_B, _OC, _CMD, _EBO, _CA],
    [[0, 1], [() => exports.OwnershipControls$, { [_hP]: 1, [_xN]: _OC }], [0, { [_hH]: _CM }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xasca }]], 2
];
exports.PutBucketPolicyRequest$ = [3, n0, _PBPR,
    0,
    [_B, _Po, _CMD, _CA, _CRSBA, _EBO],
    [[0, 1], [0, 16], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [2, { [_hH]: _xacrsba }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutBucketReplicationRequest$ = [3, n0, _PBRR,
    0,
    [_B, _RCe, _CMD, _CA, _To, _EBO],
    [[0, 1], [() => exports.ReplicationConfiguration$, { [_hP]: 1, [_xN]: _RCe }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xabolt }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutBucketRequestPaymentRequest$ = [3, n0, _PBRPR,
    0,
    [_B, _RPC, _CMD, _CA, _EBO],
    [[0, 1], [() => exports.RequestPaymentConfiguration$, { [_hP]: 1, [_xN]: _RPC }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutBucketTaggingRequest$ = [3, n0, _PBTR,
    0,
    [_B, _Tag, _CMD, _CA, _EBO],
    [[0, 1], [() => exports.Tagging$, { [_hP]: 1, [_xN]: _Tag }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutBucketVersioningRequest$ = [3, n0, _PBVR,
    0,
    [_B, _VC, _CMD, _CA, _MFA, _EBO],
    [[0, 1], [() => exports.VersioningConfiguration$, { [_hP]: 1, [_xN]: _VC }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xam_ }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutBucketWebsiteRequest$ = [3, n0, _PBWR,
    0,
    [_B, _WC, _CMD, _CA, _EBO],
    [[0, 1], [() => exports.WebsiteConfiguration$, { [_hP]: 1, [_xN]: _WC }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutObjectAclOutput$ = [3, n0, _POAO,
    0,
    [_RC],
    [[0, { [_hH]: _xarc }]]
];
exports.PutObjectAclRequest$ = [3, n0, _POAR,
    0,
    [_B, _K, _ACL_, _ACP, _CMD, _CA, _GFC, _GR, _GRACP, _GW, _GWACP, _RP, _VI, _EBO],
    [[0, 1], [0, 1], [0, { [_hH]: _xaa }], [() => exports.AccessControlPolicy$, { [_hP]: 1, [_xN]: _ACP }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xagfc }], [0, { [_hH]: _xagr }], [0, { [_hH]: _xagra }], [0, { [_hH]: _xagw }], [0, { [_hH]: _xagwa }], [0, { [_hH]: _xarp }], [0, { [_hQ]: _vI }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutObjectLegalHoldOutput$ = [3, n0, _POLHO,
    0,
    [_RC],
    [[0, { [_hH]: _xarc }]]
];
exports.PutObjectLegalHoldRequest$ = [3, n0, _POLHR,
    0,
    [_B, _K, _LH, _RP, _VI, _CMD, _CA, _EBO],
    [[0, 1], [0, 1], [() => exports.ObjectLockLegalHold$, { [_hP]: 1, [_xN]: _LH }], [0, { [_hH]: _xarp }], [0, { [_hQ]: _vI }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutObjectLockConfigurationOutput$ = [3, n0, _POLCO,
    0,
    [_RC],
    [[0, { [_hH]: _xarc }]]
];
exports.PutObjectLockConfigurationRequest$ = [3, n0, _POLCR,
    0,
    [_B, _OLC, _RP, _To, _CMD, _CA, _EBO],
    [[0, 1], [() => exports.ObjectLockConfiguration$, { [_hP]: 1, [_xN]: _OLC }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xabolt }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 1
];
exports.PutObjectOutput$ = [3, n0, _POO,
    0,
    [_E, _ETa, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh, _CT, _SSE, _VI, _SSECA, _SSECKMD, _SSEKMSKI, _SSEKMSEC, _BKE, _Si, _RC],
    [[0, { [_hH]: _xae }], [0, { [_hH]: _ETa }], [0, { [_hH]: _xacc }], [0, { [_hH]: _xacc_ }], [0, { [_hH]: _xacc__ }], [0, { [_hH]: _xacs }], [0, { [_hH]: _xacs_ }], [0, { [_hH]: _xact }], [0, { [_hH]: _xasse }], [0, { [_hH]: _xavi }], [0, { [_hH]: _xasseca }], [0, { [_hH]: _xasseckM }], [() => SSEKMSKeyId, { [_hH]: _xasseakki }], [() => SSEKMSEncryptionContext, { [_hH]: _xassec }], [2, { [_hH]: _xassebke }], [1, { [_hH]: _xaos }], [0, { [_hH]: _xarc }]]
];
exports.PutObjectRequest$ = [3, n0, _POR,
    0,
    [_B, _K, _ACL_, _Bo, _CC, _CDo, _CEo, _CL, _CLo, _CMD, _CTo, _CA, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh, _Ex, _IM, _INM, _GFC, _GR, _GRACP, _GWACP, _WOB, _M, _SSE, _SC, _WRL, _SSECA, _SSECK, _SSECKMD, _SSEKMSKI, _SSEKMSEC, _BKE, _RP, _Tag, _OLM, _OLRUD, _OLLHS, _EBO],
    [[0, 1], [0, 1], [0, { [_hH]: _xaa }], [() => StreamingBlob, 16], [0, { [_hH]: _CC_ }], [0, { [_hH]: _CD_ }], [0, { [_hH]: _CE_ }], [0, { [_hH]: _CL_ }], [1, { [_hH]: _CL__ }], [0, { [_hH]: _CM }], [0, { [_hH]: _CT_ }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xacc }], [0, { [_hH]: _xacc_ }], [0, { [_hH]: _xacc__ }], [0, { [_hH]: _xacs }], [0, { [_hH]: _xacs_ }], [4, { [_hH]: _Ex }], [0, { [_hH]: _IM_ }], [0, { [_hH]: _INM_ }], [0, { [_hH]: _xagfc }], [0, { [_hH]: _xagr }], [0, { [_hH]: _xagra }], [0, { [_hH]: _xagwa }], [1, { [_hH]: _xawob }], [128 | 0, { [_hPH]: _xam }], [0, { [_hH]: _xasse }], [0, { [_hH]: _xasc }], [0, { [_hH]: _xawrl }], [0, { [_hH]: _xasseca }], [() => SSECustomerKey, { [_hH]: _xasseck }], [0, { [_hH]: _xasseckM }], [() => SSEKMSKeyId, { [_hH]: _xasseakki }], [() => SSEKMSEncryptionContext, { [_hH]: _xassec }], [2, { [_hH]: _xassebke }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xat }], [0, { [_hH]: _xaolm }], [5, { [_hH]: _xaolrud }], [0, { [_hH]: _xaollh }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutObjectRetentionOutput$ = [3, n0, _PORO,
    0,
    [_RC],
    [[0, { [_hH]: _xarc }]]
];
exports.PutObjectRetentionRequest$ = [3, n0, _PORR,
    0,
    [_B, _K, _Ret, _RP, _VI, _BGR, _CMD, _CA, _EBO],
    [[0, 1], [0, 1], [() => exports.ObjectLockRetention$, { [_hP]: 1, [_xN]: _Ret }], [0, { [_hH]: _xarp }], [0, { [_hQ]: _vI }], [2, { [_hH]: _xabgr }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.PutObjectTaggingOutput$ = [3, n0, _POTO,
    0,
    [_VI],
    [[0, { [_hH]: _xavi }]]
];
exports.PutObjectTaggingRequest$ = [3, n0, _POTR,
    0,
    [_B, _K, _Tag, _VI, _CMD, _CA, _EBO, _RP],
    [[0, 1], [0, 1], [() => exports.Tagging$, { [_hP]: 1, [_xN]: _Tag }], [0, { [_hQ]: _vI }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xarp }]], 3
];
exports.PutPublicAccessBlockRequest$ = [3, n0, _PPABR,
    0,
    [_B, _PABC, _CMD, _CA, _EBO],
    [[0, 1], [() => exports.PublicAccessBlockConfiguration$, { [_hP]: 1, [_xN]: _PABC }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.QueueConfiguration$ = [3, n0, _QCue,
    0,
    [_QA, _Ev, _I, _F],
    [[0, { [_xN]: _Qu }], [64 | 0, { [_xF]: 1, [_xN]: _Eve }], 0, [() => exports.NotificationConfigurationFilter$, 0]], 2
];
exports.RecordExpiration$ = [3, n0, _REe,
    0,
    [_E, _D],
    [0, 1], 1
];
exports.RecordsEvent$ = [3, n0, _REec,
    0,
    [_Payl],
    [[21, { [_eP]: 1 }]]
];
exports.Redirect$ = [3, n0, _Red,
    0,
    [_HN, _HRC, _Pro, _RKPW, _RKW],
    [0, 0, 0, 0, 0]
];
exports.RedirectAllRequestsTo$ = [3, n0, _RART,
    0,
    [_HN, _Pro],
    [0, 0], 1
];
exports.RenameObjectOutput$ = [3, n0, _ROO,
    0,
    [],
    []
];
exports.RenameObjectRequest$ = [3, n0, _ROR,
    0,
    [_B, _K, _RSen, _DIM, _DINM, _DIMS, _DIUS, _SIM, _SINM, _SIMS, _SIUS, _CTl],
    [[0, 1], [0, 1], [0, { [_hH]: _xars_ }], [0, { [_hH]: _IM_ }], [0, { [_hH]: _INM_ }], [4, { [_hH]: _IMS_ }], [4, { [_hH]: _IUS_ }], [0, { [_hH]: _xarsim }], [0, { [_hH]: _xarsinm }], [6, { [_hH]: _xarsims }], [6, { [_hH]: _xarsius }], [0, { [_hH]: _xact_, [_iT]: 1 }]], 3
];
exports.ReplicaModifications$ = [3, n0, _RM,
    0,
    [_S],
    [0], 1
];
exports.ReplicationConfiguration$ = [3, n0, _RCe,
    0,
    [_Ro, _R],
    [0, [() => ReplicationRules, { [_xF]: 1, [_xN]: _Ru }]], 2
];
exports.ReplicationRule$ = [3, n0, _RRe,
    0,
    [_S, _Des, _ID, _Pri, _P, _F, _SSC, _EOR, _DMR],
    [0, () => exports.Destination$, 0, 1, 0, [() => exports.ReplicationRuleFilter$, 0], () => exports.SourceSelectionCriteria$, () => exports.ExistingObjectReplication$, () => exports.DeleteMarkerReplication$], 2
];
exports.ReplicationRuleAndOperator$ = [3, n0, _RRAO,
    0,
    [_P, _T],
    [0, [() => TagSet, { [_xF]: 1, [_xN]: _Ta }]]
];
exports.ReplicationRuleFilter$ = [3, n0, _RRF,
    0,
    [_P, _Ta, _An],
    [0, () => exports.Tag$, [() => exports.ReplicationRuleAndOperator$, 0]]
];
exports.ReplicationTime$ = [3, n0, _RT,
    0,
    [_S, _Tim],
    [0, () => exports.ReplicationTimeValue$], 2
];
exports.ReplicationTimeValue$ = [3, n0, _RTV,
    0,
    [_Mi],
    [1]
];
exports.RequestPaymentConfiguration$ = [3, n0, _RPC,
    0,
    [_Pay],
    [0], 1
];
exports.RequestProgress$ = [3, n0, _RPe,
    0,
    [_Ena],
    [2]
];
exports.RestoreObjectOutput$ = [3, n0, _ROOe,
    0,
    [_RC, _ROP],
    [[0, { [_hH]: _xarc }], [0, { [_hH]: _xarop }]]
];
exports.RestoreObjectRequest$ = [3, n0, _RORe,
    0,
    [_B, _K, _VI, _RRes, _RP, _CA, _EBO],
    [[0, 1], [0, 1], [0, { [_hQ]: _vI }], [() => exports.RestoreRequest$, { [_hP]: 1, [_xN]: _RRes }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.RestoreRequest$ = [3, n0, _RRes,
    0,
    [_D, _GJP, _Ty, _Ti, _Desc, _SP, _OL],
    [1, () => exports.GlacierJobParameters$, 0, 0, 0, () => exports.SelectParameters$, [() => exports.OutputLocation$, 0]]
];
exports.RestoreStatus$ = [3, n0, _RSe,
    0,
    [_IRIP, _RED],
    [2, 4]
];
exports.RoutingRule$ = [3, n0, _RRo,
    0,
    [_Red, _Co],
    [() => exports.Redirect$, () => exports.Condition$], 1
];
exports.S3KeyFilter$ = [3, n0, _SKF,
    0,
    [_FRi],
    [[() => FilterRuleList, { [_xF]: 1, [_xN]: _FR }]]
];
exports.S3Location$ = [3, n0, _SL,
    0,
    [_BN, _P, _En, _CACL, _ACL, _Tag, _UM, _SC],
    [0, 0, [() => exports.Encryption$, 0], 0, [() => Grants, 0], [() => exports.Tagging$, 0], [() => UserMetadata, 0], 0], 2
];
exports.S3TablesDestination$ = [3, n0, _STD,
    0,
    [_TBA, _TNa],
    [0, 0], 2
];
exports.S3TablesDestinationResult$ = [3, n0, _STDR,
    0,
    [_TBA, _TNa, _TA, _TN],
    [0, 0, 0, 0], 4
];
exports.ScanRange$ = [3, n0, _SR,
    0,
    [_St, _End],
    [1, 1]
];
exports.SelectObjectContentOutput$ = [3, n0, _SOCO,
    0,
    [_Payl],
    [[() => exports.SelectObjectContentEventStream$, 16]]
];
exports.SelectObjectContentRequest$ = [3, n0, _SOCR,
    0,
    [_B, _K, _Exp, _ETx, _IS, _OSu, _SSECA, _SSECK, _SSECKMD, _RPe, _SR, _EBO],
    [[0, 1], [0, 1], 0, 0, () => exports.InputSerialization$, () => exports.OutputSerialization$, [0, { [_hH]: _xasseca }], [() => SSECustomerKey, { [_hH]: _xasseck }], [0, { [_hH]: _xasseckM }], () => exports.RequestProgress$, () => exports.ScanRange$, [0, { [_hH]: _xaebo }]], 6
];
exports.SelectParameters$ = [3, n0, _SP,
    0,
    [_IS, _ETx, _Exp, _OSu],
    [() => exports.InputSerialization$, 0, 0, () => exports.OutputSerialization$], 4
];
exports.ServerSideEncryptionByDefault$ = [3, n0, _SSEBD,
    0,
    [_SSEA, _KMSMKID],
    [0, [() => SSEKMSKeyId, 0]], 1
];
exports.ServerSideEncryptionConfiguration$ = [3, n0, _SSEC,
    0,
    [_R],
    [[() => ServerSideEncryptionRules, { [_xF]: 1, [_xN]: _Ru }]], 1
];
exports.ServerSideEncryptionRule$ = [3, n0, _SSER,
    0,
    [_ASSEBD, _BKE, _BET],
    [[() => exports.ServerSideEncryptionByDefault$, 0], 2, [() => exports.BlockedEncryptionTypes$, 0]]
];
exports.SessionCredentials$ = [3, n0, _SCe,
    0,
    [_AKI, _SAK, _ST, _E],
    [[0, { [_xN]: _AKI }], [() => SessionCredentialValue, { [_xN]: _SAK }], [() => SessionCredentialValue, { [_xN]: _ST }], [4, { [_xN]: _E }]], 4
];
exports.SimplePrefix$ = [3, n0, _SPi,
    { [_xN]: _SPi },
    [],
    []
];
exports.SourceSelectionCriteria$ = [3, n0, _SSC,
    0,
    [_SKEO, _RM],
    [() => exports.SseKmsEncryptedObjects$, () => exports.ReplicaModifications$]
];
exports.SSEKMS$ = [3, n0, _SSEKMS,
    { [_xN]: _SK },
    [_KI],
    [[() => SSEKMSKeyId, 0]], 1
];
exports.SseKmsEncryptedObjects$ = [3, n0, _SKEO,
    0,
    [_S],
    [0], 1
];
exports.SSEKMSEncryption$ = [3, n0, _SSEKMSE,
    { [_xN]: _SK },
    [_KMSKA, _BKE],
    [[() => NonEmptyKmsKeyArnString, 0], 2], 1
];
exports.SSES3$ = [3, n0, _SSES,
    { [_xN]: _SS },
    [],
    []
];
exports.Stats$ = [3, n0, _Sta,
    0,
    [_BS, _BP, _BRy],
    [1, 1, 1]
];
exports.StatsEvent$ = [3, n0, _SE,
    0,
    [_Det],
    [[() => exports.Stats$, { [_eP]: 1 }]]
];
exports.StorageClassAnalysis$ = [3, n0, _SCA,
    0,
    [_DE],
    [() => exports.StorageClassAnalysisDataExport$]
];
exports.StorageClassAnalysisDataExport$ = [3, n0, _SCADE,
    0,
    [_OSV, _Des],
    [0, () => exports.AnalyticsExportDestination$], 2
];
exports.Tag$ = [3, n0, _Ta,
    0,
    [_K, _V],
    [0, 0], 2
];
exports.Tagging$ = [3, n0, _Tag,
    0,
    [_TS],
    [[() => TagSet, 0]], 1
];
exports.TargetGrant$ = [3, n0, _TGa,
    0,
    [_Gra, _Pe],
    [[() => exports.Grantee$, { [_xNm]: [_x, _hi] }], 0]
];
exports.TargetObjectKeyFormat$ = [3, n0, _TOKF,
    0,
    [_SPi, _PP],
    [[() => exports.SimplePrefix$, { [_xN]: _SPi }], [() => exports.PartitionedPrefix$, { [_xN]: _PP }]]
];
exports.Tiering$ = [3, n0, _Tier,
    0,
    [_D, _AT],
    [1, 0], 2
];
exports.TopicConfiguration$ = [3, n0, _TCop,
    0,
    [_TAo, _Ev, _I, _F],
    [[0, { [_xN]: _Top }], [64 | 0, { [_xF]: 1, [_xN]: _Eve }], 0, [() => exports.NotificationConfigurationFilter$, 0]], 2
];
exports.Transition$ = [3, n0, _Tra,
    0,
    [_Da, _D, _SC],
    [5, 1, 0]
];
exports.UpdateBucketMetadataInventoryTableConfigurationRequest$ = [3, n0, _UBMITCR,
    0,
    [_B, _ITCn, _CMD, _CA, _EBO],
    [[0, 1], [() => exports.InventoryTableConfigurationUpdates$, { [_hP]: 1, [_xN]: _ITCn }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.UpdateBucketMetadataJournalTableConfigurationRequest$ = [3, n0, _UBMJTCR,
    0,
    [_B, _JTC, _CMD, _CA, _EBO],
    [[0, 1], [() => exports.JournalTableConfigurationUpdates$, { [_hP]: 1, [_xN]: _JTC }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xaebo }]], 2
];
exports.UpdateObjectEncryptionRequest$ = [3, n0, _UOER,
    0,
    [_B, _K, _OE, _VI, _RP, _EBO, _CMD, _CA],
    [[0, 1], [0, 1], [() => exports.ObjectEncryption$, 16], [0, { [_hQ]: _vI }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }]], 3
];
exports.UpdateObjectEncryptionResponse$ = [3, n0, _UOERp,
    0,
    [_RC],
    [[0, { [_hH]: _xarc }]]
];
exports.UploadPartCopyOutput$ = [3, n0, _UPCO,
    0,
    [_CSVI, _CPR, _SSE, _SSECA, _SSECKMD, _SSEKMSKI, _BKE, _RC],
    [[0, { [_hH]: _xacsvi }], [() => exports.CopyPartResult$, 16], [0, { [_hH]: _xasse }], [0, { [_hH]: _xasseca }], [0, { [_hH]: _xasseckM }], [() => SSEKMSKeyId, { [_hH]: _xasseakki }], [2, { [_hH]: _xassebke }], [0, { [_hH]: _xarc }]]
];
exports.UploadPartCopyRequest$ = [3, n0, _UPCR,
    0,
    [_B, _CS, _K, _PN, _UI, _CSIM, _CSIMS, _CSINM, _CSIUS, _CSRo, _SSECA, _SSECK, _SSECKMD, _CSSSECA, _CSSSECK, _CSSSECKMD, _RP, _EBO, _ESBO],
    [[0, 1], [0, { [_hH]: _xacs__ }], [0, 1], [1, { [_hQ]: _pN }], [0, { [_hQ]: _uI }], [0, { [_hH]: _xacsim }], [4, { [_hH]: _xacsims }], [0, { [_hH]: _xacsinm }], [4, { [_hH]: _xacsius }], [0, { [_hH]: _xacsr }], [0, { [_hH]: _xasseca }], [() => SSECustomerKey, { [_hH]: _xasseck }], [0, { [_hH]: _xasseckM }], [0, { [_hH]: _xacssseca }], [() => CopySourceSSECustomerKey, { [_hH]: _xacssseck }], [0, { [_hH]: _xacssseckM }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xaebo }], [0, { [_hH]: _xasebo }]], 5
];
exports.UploadPartOutput$ = [3, n0, _UPO,
    0,
    [_SSE, _ETa, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh, _SSECA, _SSECKMD, _SSEKMSKI, _BKE, _RC],
    [[0, { [_hH]: _xasse }], [0, { [_hH]: _ETa }], [0, { [_hH]: _xacc }], [0, { [_hH]: _xacc_ }], [0, { [_hH]: _xacc__ }], [0, { [_hH]: _xacs }], [0, { [_hH]: _xacs_ }], [0, { [_hH]: _xasseca }], [0, { [_hH]: _xasseckM }], [() => SSEKMSKeyId, { [_hH]: _xasseakki }], [2, { [_hH]: _xassebke }], [0, { [_hH]: _xarc }]]
];
exports.UploadPartRequest$ = [3, n0, _UPR,
    0,
    [_B, _K, _PN, _UI, _Bo, _CLo, _CMD, _CA, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh, _SSECA, _SSECK, _SSECKMD, _RP, _EBO],
    [[0, 1], [0, 1], [1, { [_hQ]: _pN }], [0, { [_hQ]: _uI }], [() => StreamingBlob, 16], [1, { [_hH]: _CL__ }], [0, { [_hH]: _CM }], [0, { [_hH]: _xasca }], [0, { [_hH]: _xacc }], [0, { [_hH]: _xacc_ }], [0, { [_hH]: _xacc__ }], [0, { [_hH]: _xacs }], [0, { [_hH]: _xacs_ }], [0, { [_hH]: _xasseca }], [() => SSECustomerKey, { [_hH]: _xasseck }], [0, { [_hH]: _xasseckM }], [0, { [_hH]: _xarp }], [0, { [_hH]: _xaebo }]], 4
];
exports.VersioningConfiguration$ = [3, n0, _VC,
    0,
    [_MFAD, _S],
    [[0, { [_xN]: _MDf }], 0]
];
exports.WebsiteConfiguration$ = [3, n0, _WC,
    0,
    [_EDr, _IDn, _RART, _RR],
    [() => exports.ErrorDocument$, () => exports.IndexDocument$, () => exports.RedirectAllRequestsTo$, [() => RoutingRules, 0]]
];
exports.WriteGetObjectResponseRequest$ = [3, n0, _WGORR,
    0,
    [_RReq, _RTe, _Bo, _SCt, _ECr, _EM, _AR, _CC, _CDo, _CEo, _CL, _CLo, _CR, _CTo, _CCRC, _CCRCC, _CCRCNVME, _CSHA, _CSHAh, _DM, _ETa, _Ex, _E, _LM, _MM, _M, _OLM, _OLLHS, _OLRUD, _PC, _RS, _RC, _Re, _SSE, _SSECA, _SSEKMSKI, _SSECKMD, _SC, _TC, _VI, _BKE],
    [[0, { [_hL]: 1, [_hH]: _xarr }], [0, { [_hH]: _xart }], [() => StreamingBlob, 16], [1, { [_hH]: _xafs }], [0, { [_hH]: _xafec }], [0, { [_hH]: _xafem }], [0, { [_hH]: _xafhar }], [0, { [_hH]: _xafhCC }], [0, { [_hH]: _xafhCD }], [0, { [_hH]: _xafhCE }], [0, { [_hH]: _xafhCL }], [1, { [_hH]: _CL__ }], [0, { [_hH]: _xafhCR }], [0, { [_hH]: _xafhCT }], [0, { [_hH]: _xafhxacc }], [0, { [_hH]: _xafhxacc_ }], [0, { [_hH]: _xafhxacc__ }], [0, { [_hH]: _xafhxacs }], [0, { [_hH]: _xafhxacs_ }], [2, { [_hH]: _xafhxadm }], [0, { [_hH]: _xafhE }], [4, { [_hH]: _xafhE_ }], [0, { [_hH]: _xafhxae }], [4, { [_hH]: _xafhLM }], [1, { [_hH]: _xafhxamm }], [128 | 0, { [_hPH]: _xam }], [0, { [_hH]: _xafhxaolm }], [0, { [_hH]: _xafhxaollh }], [5, { [_hH]: _xafhxaolrud }], [1, { [_hH]: _xafhxampc }], [0, { [_hH]: _xafhxars }], [0, { [_hH]: _xafhxarc }], [0, { [_hH]: _xafhxar }], [0, { [_hH]: _xafhxasse }], [0, { [_hH]: _xafhxasseca }], [() => SSEKMSKeyId, { [_hH]: _xafhxasseakki }], [0, { [_hH]: _xafhxasseckM }], [0, { [_hH]: _xafhxasc }], [1, { [_hH]: _xafhxatc }], [0, { [_hH]: _xafhxavi }], [2, { [_hH]: _xafhxassebke }]], 2
];
var __Unit = "unit";
var AllowedHeaders = (/* unused pure expression or super */ null && (64 | 0));
var AllowedMethods = (/* unused pure expression or super */ null && (64 | 0));
var AllowedOrigins = (/* unused pure expression or super */ null && (64 | 0));
var AnalyticsConfigurationList = [1, n0, _ACLn,
    0, [() => exports.AnalyticsConfiguration$,
        0]
];
var Buckets = [1, n0, _Bu,
    0, [() => exports.Bucket$,
        { [_xN]: _B }]
];
var ChecksumAlgorithmList = (/* unused pure expression or super */ null && (64 | 0));
var CommonPrefixList = [1, n0, _CPL,
    0, () => exports.CommonPrefix$
];
var CompletedPartList = [1, n0, _CPLo,
    0, () => exports.CompletedPart$
];
var CORSRules = [1, n0, _CORSR,
    0, [() => exports.CORSRule$,
        0]
];
var DeletedObjects = [1, n0, _DOe,
    0, () => exports.DeletedObject$
];
var DeleteMarkers = [1, n0, _DMe,
    0, () => exports.DeleteMarkerEntry$
];
var EncryptionTypeList = [1, n0, _ETL,
    0, [0,
        { [_xN]: _ET }]
];
var Errors = [1, n0, _Er,
    0, () => exports._Error$
];
var EventList = (/* unused pure expression or super */ null && (64 | 0));
var ExposeHeaders = (/* unused pure expression or super */ null && (64 | 0));
var FilterRuleList = [1, n0, _FRL,
    0, () => exports.FilterRule$
];
var Grants = [1, n0, _G,
    0, [() => exports.Grant$,
        { [_xN]: _Gr }]
];
var IntelligentTieringConfigurationList = [1, n0, _ITCL,
    0, [() => exports.IntelligentTieringConfiguration$,
        0]
];
var InventoryConfigurationList = [1, n0, _ICL,
    0, [() => exports.InventoryConfiguration$,
        0]
];
var InventoryOptionalFields = [1, n0, _IOF,
    0, [0,
        { [_xN]: _Fi }]
];
var LambdaFunctionConfigurationList = [1, n0, _LFCL,
    0, [() => exports.LambdaFunctionConfiguration$,
        0]
];
var LifecycleRules = [1, n0, _LRi,
    0, [() => exports.LifecycleRule$,
        0]
];
var MetricsConfigurationList = [1, n0, _MCL,
    0, [() => exports.MetricsConfiguration$,
        0]
];
var MultipartUploadList = [1, n0, _MUL,
    0, () => exports.MultipartUpload$
];
var NoncurrentVersionTransitionList = [1, n0, _NVTL,
    0, () => exports.NoncurrentVersionTransition$
];
var ObjectAttributesList = (/* unused pure expression or super */ null && (64 | 0));
var ObjectIdentifierList = [1, n0, _OIL,
    0, () => exports.ObjectIdentifier$
];
var ObjectList = [1, n0, _OLb,
    0, [() => exports._Object$,
        0]
];
var ObjectVersionList = [1, n0, _OVL,
    0, [() => exports.ObjectVersion$,
        0]
];
var OptionalObjectAttributesList = (/* unused pure expression or super */ null && (64 | 0));
var OwnershipControlsRules = [1, n0, _OCRw,
    0, () => exports.OwnershipControlsRule$
];
var Parts = [1, n0, _Pa,
    0, () => exports.Part$
];
var PartsList = [1, n0, _PL,
    0, () => exports.ObjectPart$
];
var QueueConfigurationList = [1, n0, _QCL,
    0, [() => exports.QueueConfiguration$,
        0]
];
var ReplicationRules = [1, n0, _RRep,
    0, [() => exports.ReplicationRule$,
        0]
];
var RoutingRules = [1, n0, _RR,
    0, [() => exports.RoutingRule$,
        { [_xN]: _RRo }]
];
var ServerSideEncryptionRules = [1, n0, _SSERe,
    0, [() => exports.ServerSideEncryptionRule$,
        0]
];
var TagSet = [1, n0, _TS,
    0, [() => exports.Tag$,
        { [_xN]: _Ta }]
];
var TargetGrants = [1, n0, _TG,
    0, [() => exports.TargetGrant$,
        { [_xN]: _Gr }]
];
var TieringList = [1, n0, _TL,
    0, () => exports.Tiering$
];
var TopicConfigurationList = [1, n0, _TCL,
    0, [() => exports.TopicConfiguration$,
        0]
];
var TransitionList = [1, n0, _TLr,
    0, () => exports.Transition$
];
var UserMetadata = [1, n0, _UM,
    0, [() => exports.MetadataEntry$,
        { [_xN]: _ME }]
];
var Metadata = (/* unused pure expression or super */ null && (128 | 0));
exports.AnalyticsFilter$ = [4, n0, _AF,
    0,
    [_P, _Ta, _An],
    [0, () => exports.Tag$, [() => exports.AnalyticsAndOperator$, 0]]
];
exports.MetricsFilter$ = [4, n0, _MF,
    0,
    [_P, _Ta, _APAc, _An],
    [0, () => exports.Tag$, 0, [() => exports.MetricsAndOperator$, 0]]
];
exports.ObjectEncryption$ = [4, n0, _OE,
    0,
    [_SSEKMS],
    [[() => exports.SSEKMSEncryption$, { [_xN]: _SK }]]
];
exports.SelectObjectContentEventStream$ = [4, n0, _SOCES,
    { [_st]: 1 },
    [_Rec, _Sta, _Pr, _Cont, _End],
    [[() => exports.RecordsEvent$, 0], [() => exports.StatsEvent$, 0], [() => exports.ProgressEvent$, 0], () => exports.ContinuationEvent$, () => exports.EndEvent$]
];
exports.AbortMultipartUpload$ = [9, n0, _AMU,
    { [_h]: ["DELETE", "/{Key+}?x-id=AbortMultipartUpload", 204] }, () => exports.AbortMultipartUploadRequest$, () => exports.AbortMultipartUploadOutput$
];
exports.CompleteMultipartUpload$ = [9, n0, _CMUo,
    { [_h]: ["POST", "/{Key+}", 200] }, () => exports.CompleteMultipartUploadRequest$, () => exports.CompleteMultipartUploadOutput$
];
exports.CopyObject$ = [9, n0, _CO,
    { [_h]: ["PUT", "/{Key+}?x-id=CopyObject", 200] }, () => exports.CopyObjectRequest$, () => exports.CopyObjectOutput$
];
exports.CreateBucket$ = [9, n0, _CB,
    { [_h]: ["PUT", "/", 200] }, () => exports.CreateBucketRequest$, () => exports.CreateBucketOutput$
];
exports.CreateBucketMetadataConfiguration$ = [9, n0, _CBMC,
    { [_hC]: "-", [_h]: ["POST", "/?metadataConfiguration", 200] }, () => exports.CreateBucketMetadataConfigurationRequest$, () => __Unit
];
exports.CreateBucketMetadataTableConfiguration$ = [9, n0, _CBMTC,
    { [_hC]: "-", [_h]: ["POST", "/?metadataTable", 200] }, () => exports.CreateBucketMetadataTableConfigurationRequest$, () => __Unit
];
exports.CreateMultipartUpload$ = [9, n0, _CMUr,
    { [_h]: ["POST", "/{Key+}?uploads", 200] }, () => exports.CreateMultipartUploadRequest$, () => exports.CreateMultipartUploadOutput$
];
exports.CreateSession$ = [9, n0, _CSr,
    { [_h]: ["GET", "/?session", 200] }, () => exports.CreateSessionRequest$, () => exports.CreateSessionOutput$
];
exports.DeleteBucket$ = [9, n0, _DB,
    { [_h]: ["DELETE", "/", 204] }, () => exports.DeleteBucketRequest$, () => __Unit
];
exports.DeleteBucketAnalyticsConfiguration$ = [9, n0, _DBAC,
    { [_h]: ["DELETE", "/?analytics", 204] }, () => exports.DeleteBucketAnalyticsConfigurationRequest$, () => __Unit
];
exports.DeleteBucketCors$ = [9, n0, _DBC,
    { [_h]: ["DELETE", "/?cors", 204] }, () => exports.DeleteBucketCorsRequest$, () => __Unit
];
exports.DeleteBucketEncryption$ = [9, n0, _DBE,
    { [_h]: ["DELETE", "/?encryption", 204] }, () => exports.DeleteBucketEncryptionRequest$, () => __Unit
];
exports.DeleteBucketIntelligentTieringConfiguration$ = [9, n0, _DBITC,
    { [_h]: ["DELETE", "/?intelligent-tiering", 204] }, () => exports.DeleteBucketIntelligentTieringConfigurationRequest$, () => __Unit
];
exports.DeleteBucketInventoryConfiguration$ = [9, n0, _DBIC,
    { [_h]: ["DELETE", "/?inventory", 204] }, () => exports.DeleteBucketInventoryConfigurationRequest$, () => __Unit
];
exports.DeleteBucketLifecycle$ = [9, n0, _DBL,
    { [_h]: ["DELETE", "/?lifecycle", 204] }, () => exports.DeleteBucketLifecycleRequest$, () => __Unit
];
exports.DeleteBucketMetadataConfiguration$ = [9, n0, _DBMC,
    { [_h]: ["DELETE", "/?metadataConfiguration", 204] }, () => exports.DeleteBucketMetadataConfigurationRequest$, () => __Unit
];
exports.DeleteBucketMetadataTableConfiguration$ = [9, n0, _DBMTC,
    { [_h]: ["DELETE", "/?metadataTable", 204] }, () => exports.DeleteBucketMetadataTableConfigurationRequest$, () => __Unit
];
exports.DeleteBucketMetricsConfiguration$ = [9, n0, _DBMCe,
    { [_h]: ["DELETE", "/?metrics", 204] }, () => exports.DeleteBucketMetricsConfigurationRequest$, () => __Unit
];
exports.DeleteBucketOwnershipControls$ = [9, n0, _DBOC,
    { [_h]: ["DELETE", "/?ownershipControls", 204] }, () => exports.DeleteBucketOwnershipControlsRequest$, () => __Unit
];
exports.DeleteBucketPolicy$ = [9, n0, _DBP,
    { [_h]: ["DELETE", "/?policy", 204] }, () => exports.DeleteBucketPolicyRequest$, () => __Unit
];
exports.DeleteBucketReplication$ = [9, n0, _DBRe,
    { [_h]: ["DELETE", "/?replication", 204] }, () => exports.DeleteBucketReplicationRequest$, () => __Unit
];
exports.DeleteBucketTagging$ = [9, n0, _DBT,
    { [_h]: ["DELETE", "/?tagging", 204] }, () => exports.DeleteBucketTaggingRequest$, () => __Unit
];
exports.DeleteBucketWebsite$ = [9, n0, _DBW,
    { [_h]: ["DELETE", "/?website", 204] }, () => exports.DeleteBucketWebsiteRequest$, () => __Unit
];
exports.DeleteObject$ = [9, n0, _DOel,
    { [_h]: ["DELETE", "/{Key+}?x-id=DeleteObject", 204] }, () => exports.DeleteObjectRequest$, () => exports.DeleteObjectOutput$
];
exports.DeleteObjects$ = [9, n0, _DOele,
    { [_hC]: "-", [_h]: ["POST", "/?delete", 200] }, () => exports.DeleteObjectsRequest$, () => exports.DeleteObjectsOutput$
];
exports.DeleteObjectTagging$ = [9, n0, _DOT,
    { [_h]: ["DELETE", "/{Key+}?tagging", 204] }, () => exports.DeleteObjectTaggingRequest$, () => exports.DeleteObjectTaggingOutput$
];
exports.DeletePublicAccessBlock$ = [9, n0, _DPAB,
    { [_h]: ["DELETE", "/?publicAccessBlock", 204] }, () => exports.DeletePublicAccessBlockRequest$, () => __Unit
];
exports.GetBucketAbac$ = [9, n0, _GBA,
    { [_h]: ["GET", "/?abac", 200] }, () => exports.GetBucketAbacRequest$, () => exports.GetBucketAbacOutput$
];
exports.GetBucketAccelerateConfiguration$ = [9, n0, _GBAC,
    { [_h]: ["GET", "/?accelerate", 200] }, () => exports.GetBucketAccelerateConfigurationRequest$, () => exports.GetBucketAccelerateConfigurationOutput$
];
exports.GetBucketAcl$ = [9, n0, _GBAe,
    { [_h]: ["GET", "/?acl", 200] }, () => exports.GetBucketAclRequest$, () => exports.GetBucketAclOutput$
];
exports.GetBucketAnalyticsConfiguration$ = [9, n0, _GBACe,
    { [_h]: ["GET", "/?analytics&x-id=GetBucketAnalyticsConfiguration", 200] }, () => exports.GetBucketAnalyticsConfigurationRequest$, () => exports.GetBucketAnalyticsConfigurationOutput$
];
exports.GetBucketCors$ = [9, n0, _GBC,
    { [_h]: ["GET", "/?cors", 200] }, () => exports.GetBucketCorsRequest$, () => exports.GetBucketCorsOutput$
];
exports.GetBucketEncryption$ = [9, n0, _GBE,
    { [_h]: ["GET", "/?encryption", 200] }, () => exports.GetBucketEncryptionRequest$, () => exports.GetBucketEncryptionOutput$
];
exports.GetBucketIntelligentTieringConfiguration$ = [9, n0, _GBITC,
    { [_h]: ["GET", "/?intelligent-tiering&x-id=GetBucketIntelligentTieringConfiguration", 200] }, () => exports.GetBucketIntelligentTieringConfigurationRequest$, () => exports.GetBucketIntelligentTieringConfigurationOutput$
];
exports.GetBucketInventoryConfiguration$ = [9, n0, _GBIC,
    { [_h]: ["GET", "/?inventory&x-id=GetBucketInventoryConfiguration", 200] }, () => exports.GetBucketInventoryConfigurationRequest$, () => exports.GetBucketInventoryConfigurationOutput$
];
exports.GetBucketLifecycleConfiguration$ = [9, n0, _GBLC,
    { [_h]: ["GET", "/?lifecycle", 200] }, () => exports.GetBucketLifecycleConfigurationRequest$, () => exports.GetBucketLifecycleConfigurationOutput$
];
exports.GetBucketLocation$ = [9, n0, _GBL,
    { [_h]: ["GET", "/?location", 200] }, () => exports.GetBucketLocationRequest$, () => exports.GetBucketLocationOutput$
];
exports.GetBucketLogging$ = [9, n0, _GBLe,
    { [_h]: ["GET", "/?logging", 200] }, () => exports.GetBucketLoggingRequest$, () => exports.GetBucketLoggingOutput$
];
exports.GetBucketMetadataConfiguration$ = [9, n0, _GBMC,
    { [_h]: ["GET", "/?metadataConfiguration", 200] }, () => exports.GetBucketMetadataConfigurationRequest$, () => exports.GetBucketMetadataConfigurationOutput$
];
exports.GetBucketMetadataTableConfiguration$ = [9, n0, _GBMTC,
    { [_h]: ["GET", "/?metadataTable", 200] }, () => exports.GetBucketMetadataTableConfigurationRequest$, () => exports.GetBucketMetadataTableConfigurationOutput$
];
exports.GetBucketMetricsConfiguration$ = [9, n0, _GBMCe,
    { [_h]: ["GET", "/?metrics&x-id=GetBucketMetricsConfiguration", 200] }, () => exports.GetBucketMetricsConfigurationRequest$, () => exports.GetBucketMetricsConfigurationOutput$
];
exports.GetBucketNotificationConfiguration$ = [9, n0, _GBNC,
    { [_h]: ["GET", "/?notification", 200] }, () => exports.GetBucketNotificationConfigurationRequest$, () => exports.NotificationConfiguration$
];
exports.GetBucketOwnershipControls$ = [9, n0, _GBOC,
    { [_h]: ["GET", "/?ownershipControls", 200] }, () => exports.GetBucketOwnershipControlsRequest$, () => exports.GetBucketOwnershipControlsOutput$
];
exports.GetBucketPolicy$ = [9, n0, _GBP,
    { [_h]: ["GET", "/?policy", 200] }, () => exports.GetBucketPolicyRequest$, () => exports.GetBucketPolicyOutput$
];
exports.GetBucketPolicyStatus$ = [9, n0, _GBPS,
    { [_h]: ["GET", "/?policyStatus", 200] }, () => exports.GetBucketPolicyStatusRequest$, () => exports.GetBucketPolicyStatusOutput$
];
exports.GetBucketReplication$ = [9, n0, _GBR,
    { [_h]: ["GET", "/?replication", 200] }, () => exports.GetBucketReplicationRequest$, () => exports.GetBucketReplicationOutput$
];
exports.GetBucketRequestPayment$ = [9, n0, _GBRP,
    { [_h]: ["GET", "/?requestPayment", 200] }, () => exports.GetBucketRequestPaymentRequest$, () => exports.GetBucketRequestPaymentOutput$
];
exports.GetBucketTagging$ = [9, n0, _GBT,
    { [_h]: ["GET", "/?tagging", 200] }, () => exports.GetBucketTaggingRequest$, () => exports.GetBucketTaggingOutput$
];
exports.GetBucketVersioning$ = [9, n0, _GBV,
    { [_h]: ["GET", "/?versioning", 200] }, () => exports.GetBucketVersioningRequest$, () => exports.GetBucketVersioningOutput$
];
exports.GetBucketWebsite$ = [9, n0, _GBW,
    { [_h]: ["GET", "/?website", 200] }, () => exports.GetBucketWebsiteRequest$, () => exports.GetBucketWebsiteOutput$
];
exports.GetObject$ = [9, n0, _GO,
    { [_hC]: "-", [_h]: ["GET", "/{Key+}?x-id=GetObject", 200] }, () => exports.GetObjectRequest$, () => exports.GetObjectOutput$
];
exports.GetObjectAcl$ = [9, n0, _GOA,
    { [_h]: ["GET", "/{Key+}?acl", 200] }, () => exports.GetObjectAclRequest$, () => exports.GetObjectAclOutput$
];
exports.GetObjectAttributes$ = [9, n0, _GOAe,
    { [_h]: ["GET", "/{Key+}?attributes", 200] }, () => exports.GetObjectAttributesRequest$, () => exports.GetObjectAttributesOutput$
];
exports.GetObjectLegalHold$ = [9, n0, _GOLH,
    { [_h]: ["GET", "/{Key+}?legal-hold", 200] }, () => exports.GetObjectLegalHoldRequest$, () => exports.GetObjectLegalHoldOutput$
];
exports.GetObjectLockConfiguration$ = [9, n0, _GOLC,
    { [_h]: ["GET", "/?object-lock", 200] }, () => exports.GetObjectLockConfigurationRequest$, () => exports.GetObjectLockConfigurationOutput$
];
exports.GetObjectRetention$ = [9, n0, _GORe,
    { [_h]: ["GET", "/{Key+}?retention", 200] }, () => exports.GetObjectRetentionRequest$, () => exports.GetObjectRetentionOutput$
];
exports.GetObjectTagging$ = [9, n0, _GOT,
    { [_h]: ["GET", "/{Key+}?tagging", 200] }, () => exports.GetObjectTaggingRequest$, () => exports.GetObjectTaggingOutput$
];
exports.GetObjectTorrent$ = [9, n0, _GOTe,
    { [_h]: ["GET", "/{Key+}?torrent", 200] }, () => exports.GetObjectTorrentRequest$, () => exports.GetObjectTorrentOutput$
];
exports.GetPublicAccessBlock$ = [9, n0, _GPAB,
    { [_h]: ["GET", "/?publicAccessBlock", 200] }, () => exports.GetPublicAccessBlockRequest$, () => exports.GetPublicAccessBlockOutput$
];
exports.HeadBucket$ = [9, n0, _HB,
    { [_h]: ["HEAD", "/", 200] }, () => exports.HeadBucketRequest$, () => exports.HeadBucketOutput$
];
exports.HeadObject$ = [9, n0, _HO,
    { [_h]: ["HEAD", "/{Key+}", 200] }, () => exports.HeadObjectRequest$, () => exports.HeadObjectOutput$
];
exports.ListBucketAnalyticsConfigurations$ = [9, n0, _LBAC,
    { [_h]: ["GET", "/?analytics&x-id=ListBucketAnalyticsConfigurations", 200] }, () => exports.ListBucketAnalyticsConfigurationsRequest$, () => exports.ListBucketAnalyticsConfigurationsOutput$
];
exports.ListBucketIntelligentTieringConfigurations$ = [9, n0, _LBITC,
    { [_h]: ["GET", "/?intelligent-tiering&x-id=ListBucketIntelligentTieringConfigurations", 200] }, () => exports.ListBucketIntelligentTieringConfigurationsRequest$, () => exports.ListBucketIntelligentTieringConfigurationsOutput$
];
exports.ListBucketInventoryConfigurations$ = [9, n0, _LBIC,
    { [_h]: ["GET", "/?inventory&x-id=ListBucketInventoryConfigurations", 200] }, () => exports.ListBucketInventoryConfigurationsRequest$, () => exports.ListBucketInventoryConfigurationsOutput$
];
exports.ListBucketMetricsConfigurations$ = [9, n0, _LBMC,
    { [_h]: ["GET", "/?metrics&x-id=ListBucketMetricsConfigurations", 200] }, () => exports.ListBucketMetricsConfigurationsRequest$, () => exports.ListBucketMetricsConfigurationsOutput$
];
exports.ListBuckets$ = [9, n0, _LB,
    { [_h]: ["GET", "/?x-id=ListBuckets", 200] }, () => exports.ListBucketsRequest$, () => exports.ListBucketsOutput$
];
exports.ListDirectoryBuckets$ = [9, n0, _LDB,
    { [_h]: ["GET", "/?x-id=ListDirectoryBuckets", 200] }, () => exports.ListDirectoryBucketsRequest$, () => exports.ListDirectoryBucketsOutput$
];
exports.ListMultipartUploads$ = [9, n0, _LMU,
    { [_h]: ["GET", "/?uploads", 200] }, () => exports.ListMultipartUploadsRequest$, () => exports.ListMultipartUploadsOutput$
];
exports.ListObjects$ = [9, n0, _LO,
    { [_h]: ["GET", "/", 200] }, () => exports.ListObjectsRequest$, () => exports.ListObjectsOutput$
];
exports.ListObjectsV2$ = [9, n0, _LOV,
    { [_h]: ["GET", "/?list-type=2", 200] }, () => exports.ListObjectsV2Request$, () => exports.ListObjectsV2Output$
];
exports.ListObjectVersions$ = [9, n0, _LOVi,
    { [_h]: ["GET", "/?versions", 200] }, () => exports.ListObjectVersionsRequest$, () => exports.ListObjectVersionsOutput$
];
exports.ListParts$ = [9, n0, _LP,
    { [_h]: ["GET", "/{Key+}?x-id=ListParts", 200] }, () => exports.ListPartsRequest$, () => exports.ListPartsOutput$
];
exports.PutBucketAbac$ = [9, n0, _PBA,
    { [_hC]: "-", [_h]: ["PUT", "/?abac", 200] }, () => exports.PutBucketAbacRequest$, () => __Unit
];
exports.PutBucketAccelerateConfiguration$ = [9, n0, _PBAC,
    { [_hC]: "-", [_h]: ["PUT", "/?accelerate", 200] }, () => exports.PutBucketAccelerateConfigurationRequest$, () => __Unit
];
exports.PutBucketAcl$ = [9, n0, _PBAu,
    { [_hC]: "-", [_h]: ["PUT", "/?acl", 200] }, () => exports.PutBucketAclRequest$, () => __Unit
];
exports.PutBucketAnalyticsConfiguration$ = [9, n0, _PBACu,
    { [_h]: ["PUT", "/?analytics", 200] }, () => exports.PutBucketAnalyticsConfigurationRequest$, () => __Unit
];
exports.PutBucketCors$ = [9, n0, _PBC,
    { [_hC]: "-", [_h]: ["PUT", "/?cors", 200] }, () => exports.PutBucketCorsRequest$, () => __Unit
];
exports.PutBucketEncryption$ = [9, n0, _PBE,
    { [_hC]: "-", [_h]: ["PUT", "/?encryption", 200] }, () => exports.PutBucketEncryptionRequest$, () => __Unit
];
exports.PutBucketIntelligentTieringConfiguration$ = [9, n0, _PBITC,
    { [_h]: ["PUT", "/?intelligent-tiering", 200] }, () => exports.PutBucketIntelligentTieringConfigurationRequest$, () => __Unit
];
exports.PutBucketInventoryConfiguration$ = [9, n0, _PBIC,
    { [_h]: ["PUT", "/?inventory", 200] }, () => exports.PutBucketInventoryConfigurationRequest$, () => __Unit
];
exports.PutBucketLifecycleConfiguration$ = [9, n0, _PBLC,
    { [_hC]: "-", [_h]: ["PUT", "/?lifecycle", 200] }, () => exports.PutBucketLifecycleConfigurationRequest$, () => exports.PutBucketLifecycleConfigurationOutput$
];
exports.PutBucketLogging$ = [9, n0, _PBL,
    { [_hC]: "-", [_h]: ["PUT", "/?logging", 200] }, () => exports.PutBucketLoggingRequest$, () => __Unit
];
exports.PutBucketMetricsConfiguration$ = [9, n0, _PBMC,
    { [_h]: ["PUT", "/?metrics", 200] }, () => exports.PutBucketMetricsConfigurationRequest$, () => __Unit
];
exports.PutBucketNotificationConfiguration$ = [9, n0, _PBNC,
    { [_h]: ["PUT", "/?notification", 200] }, () => exports.PutBucketNotificationConfigurationRequest$, () => __Unit
];
exports.PutBucketOwnershipControls$ = [9, n0, _PBOC,
    { [_hC]: "-", [_h]: ["PUT", "/?ownershipControls", 200] }, () => exports.PutBucketOwnershipControlsRequest$, () => __Unit
];
exports.PutBucketPolicy$ = [9, n0, _PBP,
    { [_hC]: "-", [_h]: ["PUT", "/?policy", 200] }, () => exports.PutBucketPolicyRequest$, () => __Unit
];
exports.PutBucketReplication$ = [9, n0, _PBR,
    { [_hC]: "-", [_h]: ["PUT", "/?replication", 200] }, () => exports.PutBucketReplicationRequest$, () => __Unit
];
exports.PutBucketRequestPayment$ = [9, n0, _PBRP,
    { [_hC]: "-", [_h]: ["PUT", "/?requestPayment", 200] }, () => exports.PutBucketRequestPaymentRequest$, () => __Unit
];
exports.PutBucketTagging$ = [9, n0, _PBT,
    { [_hC]: "-", [_h]: ["PUT", "/?tagging", 200] }, () => exports.PutBucketTaggingRequest$, () => __Unit
];
exports.PutBucketVersioning$ = [9, n0, _PBV,
    { [_hC]: "-", [_h]: ["PUT", "/?versioning", 200] }, () => exports.PutBucketVersioningRequest$, () => __Unit
];
exports.PutBucketWebsite$ = [9, n0, _PBW,
    { [_hC]: "-", [_h]: ["PUT", "/?website", 200] }, () => exports.PutBucketWebsiteRequest$, () => __Unit
];
exports.PutObject$ = [9, n0, _PO,
    { [_hC]: "-", [_h]: ["PUT", "/{Key+}?x-id=PutObject", 200] }, () => exports.PutObjectRequest$, () => exports.PutObjectOutput$
];
exports.PutObjectAcl$ = [9, n0, _POA,
    { [_hC]: "-", [_h]: ["PUT", "/{Key+}?acl", 200] }, () => exports.PutObjectAclRequest$, () => exports.PutObjectAclOutput$
];
exports.PutObjectLegalHold$ = [9, n0, _POLH,
    { [_hC]: "-", [_h]: ["PUT", "/{Key+}?legal-hold", 200] }, () => exports.PutObjectLegalHoldRequest$, () => exports.PutObjectLegalHoldOutput$
];
exports.PutObjectLockConfiguration$ = [9, n0, _POLC,
    { [_hC]: "-", [_h]: ["PUT", "/?object-lock", 200] }, () => exports.PutObjectLockConfigurationRequest$, () => exports.PutObjectLockConfigurationOutput$
];
exports.PutObjectRetention$ = [9, n0, _PORu,
    { [_hC]: "-", [_h]: ["PUT", "/{Key+}?retention", 200] }, () => exports.PutObjectRetentionRequest$, () => exports.PutObjectRetentionOutput$
];
exports.PutObjectTagging$ = [9, n0, _POT,
    { [_hC]: "-", [_h]: ["PUT", "/{Key+}?tagging", 200] }, () => exports.PutObjectTaggingRequest$, () => exports.PutObjectTaggingOutput$
];
exports.PutPublicAccessBlock$ = [9, n0, _PPAB,
    { [_hC]: "-", [_h]: ["PUT", "/?publicAccessBlock", 200] }, () => exports.PutPublicAccessBlockRequest$, () => __Unit
];
exports.RenameObject$ = [9, n0, _RO,
    { [_h]: ["PUT", "/{Key+}?renameObject", 200] }, () => exports.RenameObjectRequest$, () => exports.RenameObjectOutput$
];
exports.RestoreObject$ = [9, n0, _ROe,
    { [_hC]: "-", [_h]: ["POST", "/{Key+}?restore", 200] }, () => exports.RestoreObjectRequest$, () => exports.RestoreObjectOutput$
];
exports.SelectObjectContent$ = [9, n0, _SOC,
    { [_h]: ["POST", "/{Key+}?select&select-type=2", 200] }, () => exports.SelectObjectContentRequest$, () => exports.SelectObjectContentOutput$
];
exports.UpdateBucketMetadataInventoryTableConfiguration$ = [9, n0, _UBMITC,
    { [_hC]: "-", [_h]: ["PUT", "/?metadataInventoryTable", 200] }, () => exports.UpdateBucketMetadataInventoryTableConfigurationRequest$, () => __Unit
];
exports.UpdateBucketMetadataJournalTableConfiguration$ = [9, n0, _UBMJTC,
    { [_hC]: "-", [_h]: ["PUT", "/?metadataJournalTable", 200] }, () => exports.UpdateBucketMetadataJournalTableConfigurationRequest$, () => __Unit
];
exports.UpdateObjectEncryption$ = [9, n0, _UOE,
    { [_hC]: "-", [_h]: ["PUT", "/{Key+}?encryption", 200] }, () => exports.UpdateObjectEncryptionRequest$, () => exports.UpdateObjectEncryptionResponse$
];
exports.UploadPart$ = [9, n0, _UP,
    { [_hC]: "-", [_h]: ["PUT", "/{Key+}?x-id=UploadPart", 200] }, () => exports.UploadPartRequest$, () => exports.UploadPartOutput$
];
exports.UploadPartCopy$ = [9, n0, _UPC,
    { [_h]: ["PUT", "/{Key+}?x-id=UploadPartCopy", 200] }, () => exports.UploadPartCopyRequest$, () => exports.UploadPartCopyOutput$
];
exports.WriteGetObjectResponse$ = [9, n0, _WGOR,
    { [_en]: ["{RequestRoute}."], [_h]: ["POST", "/WriteGetObjectResponse", 200] }, () => exports.WriteGetObjectResponseRequest$, () => __Unit
];


/***/ }),

/***/ 98950:
/***/ ((__unused_webpack_module, exports) => {



const generateCRC64NVMETable = () => {
    const sliceLength = 8;
    const tables = new Array(sliceLength);
    for (let slice = 0; slice < sliceLength; slice++) {
        const table = new Array(512);
        for (let i = 0; i < 256; i++) {
            let crc = BigInt(i);
            for (let j = 0; j < 8 * (slice + 1); j++) {
                if (crc & 1n) {
                    crc = (crc >> 1n) ^ 0x9a6c9329ac4bc9b5n;
                }
                else {
                    crc = crc >> 1n;
                }
            }
            table[i * 2] = Number((crc >> 32n) & 0xffffffffn);
            table[i * 2 + 1] = Number(crc & 0xffffffffn);
        }
        tables[slice] = new Uint32Array(table);
    }
    return tables;
};
let CRC64_NVME_REVERSED_TABLE;
let t0, t1, t2, t3;
let t4, t5, t6, t7;
const ensureTablesInitialized = () => {
    if (!CRC64_NVME_REVERSED_TABLE) {
        CRC64_NVME_REVERSED_TABLE = generateCRC64NVMETable();
        [t0, t1, t2, t3, t4, t5, t6, t7] = CRC64_NVME_REVERSED_TABLE;
    }
};
class Crc64Nvme {
    c1 = 0;
    c2 = 0;
    constructor() {
        ensureTablesInitialized();
        this.reset();
    }
    update(data) {
        const len = data.length;
        let i = 0;
        let crc1 = this.c1;
        let crc2 = this.c2;
        while (i + 8 <= len) {
            const idx0 = ((crc2 ^ data[i++]) & 255) << 1;
            const idx1 = (((crc2 >>> 8) ^ data[i++]) & 255) << 1;
            const idx2 = (((crc2 >>> 16) ^ data[i++]) & 255) << 1;
            const idx3 = (((crc2 >>> 24) ^ data[i++]) & 255) << 1;
            const idx4 = ((crc1 ^ data[i++]) & 255) << 1;
            const idx5 = (((crc1 >>> 8) ^ data[i++]) & 255) << 1;
            const idx6 = (((crc1 >>> 16) ^ data[i++]) & 255) << 1;
            const idx7 = (((crc1 >>> 24) ^ data[i++]) & 255) << 1;
            crc1 = t7[idx0] ^ t6[idx1] ^ t5[idx2] ^ t4[idx3] ^ t3[idx4] ^ t2[idx5] ^ t1[idx6] ^ t0[idx7];
            crc2 =
                t7[idx0 + 1] ^
                    t6[idx1 + 1] ^
                    t5[idx2 + 1] ^
                    t4[idx3 + 1] ^
                    t3[idx4 + 1] ^
                    t2[idx5 + 1] ^
                    t1[idx6 + 1] ^
                    t0[idx7 + 1];
        }
        while (i < len) {
            const idx = ((crc2 ^ data[i]) & 255) << 1;
            crc2 = ((crc2 >>> 8) | ((crc1 & 255) << 24)) >>> 0;
            crc1 = (crc1 >>> 8) ^ t0[idx];
            crc2 ^= t0[idx + 1];
            i++;
        }
        this.c1 = crc1;
        this.c2 = crc2;
    }
    async digest() {
        const c1 = this.c1 ^ 4294967295;
        const c2 = this.c2 ^ 4294967295;
        return new Uint8Array([
            c1 >>> 24,
            (c1 >>> 16) & 255,
            (c1 >>> 8) & 255,
            c1 & 255,
            c2 >>> 24,
            (c2 >>> 16) & 255,
            (c2 >>> 8) & 255,
            c2 & 255,
        ]);
    }
    reset() {
        this.c1 = 4294967295;
        this.c2 = 4294967295;
    }
}

const crc64NvmeCrtContainer = {
    CrtCrc64Nvme: null,
};

exports.Crc64Nvme = Crc64Nvme;
exports.crc64NvmeCrtContainer = crc64NvmeCrtContainer;


/***/ }),

/***/ 16466:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var utilConfigProvider = __webpack_require__(55936);
var utilArnParser = __webpack_require__(50077);
var protocolHttp = __webpack_require__(29752);

const NODE_DISABLE_MULTIREGION_ACCESS_POINT_ENV_NAME = "AWS_S3_DISABLE_MULTIREGION_ACCESS_POINTS";
const NODE_DISABLE_MULTIREGION_ACCESS_POINT_INI_NAME = "s3_disable_multiregion_access_points";
const NODE_DISABLE_MULTIREGION_ACCESS_POINT_CONFIG_OPTIONS = {
    environmentVariableSelector: (env) => utilConfigProvider.booleanSelector(env, NODE_DISABLE_MULTIREGION_ACCESS_POINT_ENV_NAME, utilConfigProvider.SelectorType.ENV),
    configFileSelector: (profile) => utilConfigProvider.booleanSelector(profile, NODE_DISABLE_MULTIREGION_ACCESS_POINT_INI_NAME, utilConfigProvider.SelectorType.CONFIG),
    default: false,
};

const NODE_USE_ARN_REGION_ENV_NAME = "AWS_S3_USE_ARN_REGION";
const NODE_USE_ARN_REGION_INI_NAME = "s3_use_arn_region";
const NODE_USE_ARN_REGION_CONFIG_OPTIONS = {
    environmentVariableSelector: (env) => utilConfigProvider.booleanSelector(env, NODE_USE_ARN_REGION_ENV_NAME, utilConfigProvider.SelectorType.ENV),
    configFileSelector: (profile) => utilConfigProvider.booleanSelector(profile, NODE_USE_ARN_REGION_INI_NAME, utilConfigProvider.SelectorType.CONFIG),
    default: undefined,
};

const DOMAIN_PATTERN = /^[a-z0-9][a-z0-9\.\-]{1,61}[a-z0-9]$/;
const IP_ADDRESS_PATTERN = /(\d+\.){3}\d+/;
const DOTS_PATTERN = /\.\./;
const DOT_PATTERN = /\./;
const S3_HOSTNAME_PATTERN = /^(.+\.)?s3(-fips)?(\.dualstack)?[.-]([a-z0-9-]+)\./;
const S3_US_EAST_1_ALTNAME_PATTERN = /^s3(-external-1)?\.amazonaws\.com$/;
const AWS_PARTITION_SUFFIX = "amazonaws.com";
const isBucketNameOptions = (options) => typeof options.bucketName === "string";
const isDnsCompatibleBucketName = (bucketName) => DOMAIN_PATTERN.test(bucketName) && !IP_ADDRESS_PATTERN.test(bucketName) && !DOTS_PATTERN.test(bucketName);
const getRegionalSuffix = (hostname) => {
    const parts = hostname.match(S3_HOSTNAME_PATTERN);
    return [parts[4], hostname.replace(new RegExp(`^${parts[0]}`), "")];
};
const getSuffix = (hostname) => S3_US_EAST_1_ALTNAME_PATTERN.test(hostname) ? ["us-east-1", AWS_PARTITION_SUFFIX] : getRegionalSuffix(hostname);
const getSuffixForArnEndpoint = (hostname) => S3_US_EAST_1_ALTNAME_PATTERN.test(hostname)
    ? [hostname.replace(`.${AWS_PARTITION_SUFFIX}`, ""), AWS_PARTITION_SUFFIX]
    : getRegionalSuffix(hostname);
const validateArnEndpointOptions = (options) => {
    if (options.pathStyleEndpoint) {
        throw new Error("Path-style S3 endpoint is not supported when bucket is an ARN");
    }
    if (options.accelerateEndpoint) {
        throw new Error("Accelerate endpoint is not supported when bucket is an ARN");
    }
    if (!options.tlsCompatible) {
        throw new Error("HTTPS is required when bucket is an ARN");
    }
};
const validateService = (service) => {
    if (service !== "s3" && service !== "s3-outposts" && service !== "s3-object-lambda") {
        throw new Error("Expect 's3' or 's3-outposts' or 's3-object-lambda' in ARN service component");
    }
};
const validateS3Service = (service) => {
    if (service !== "s3") {
        throw new Error("Expect 's3' in Accesspoint ARN service component");
    }
};
const validateOutpostService = (service) => {
    if (service !== "s3-outposts") {
        throw new Error("Expect 's3-posts' in Outpost ARN service component");
    }
};
const validatePartition = (partition, options) => {
    if (partition !== options.clientPartition) {
        throw new Error(`Partition in ARN is incompatible, got "${partition}" but expected "${options.clientPartition}"`);
    }
};
const validateRegion = (region, options) => { };
const validateRegionalClient = (region) => {
    if (["s3-external-1", "aws-global"].includes(region)) {
        throw new Error(`Client region ${region} is not regional`);
    }
};
const validateAccountId = (accountId) => {
    if (!/[0-9]{12}/.exec(accountId)) {
        throw new Error("Access point ARN accountID does not match regex '[0-9]{12}'");
    }
};
const validateDNSHostLabel = (label, options = { tlsCompatible: true }) => {
    if (label.length >= 64 ||
        !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(label) ||
        /(\d+\.){3}\d+/.test(label) ||
        /[.-]{2}/.test(label) ||
        (options?.tlsCompatible && DOT_PATTERN.test(label))) {
        throw new Error(`Invalid DNS label ${label}`);
    }
};
const validateCustomEndpoint = (options) => {
    if (options.isCustomEndpoint) {
        if (options.dualstackEndpoint)
            throw new Error("Dualstack endpoint is not supported with custom endpoint");
        if (options.accelerateEndpoint)
            throw new Error("Accelerate endpoint is not supported with custom endpoint");
    }
};
const getArnResources = (resource) => {
    const delimiter = resource.includes(":") ? ":" : "/";
    const [resourceType, ...rest] = resource.split(delimiter);
    if (resourceType === "accesspoint") {
        if (rest.length !== 1 || rest[0] === "") {
            throw new Error(`Access Point ARN should have one resource accesspoint${delimiter}{accesspointname}`);
        }
        return { accesspointName: rest[0] };
    }
    else if (resourceType === "outpost") {
        if (!rest[0] || rest[1] !== "accesspoint" || !rest[2] || rest.length !== 3) {
            throw new Error(`Outpost ARN should have resource outpost${delimiter}{outpostId}${delimiter}accesspoint${delimiter}{accesspointName}`);
        }
        const [outpostId, _, accesspointName] = rest;
        return { outpostId, accesspointName };
    }
    else {
        throw new Error(`ARN resource should begin with 'accesspoint${delimiter}' or 'outpost${delimiter}'`);
    }
};
const validateNoDualstack = (dualstackEndpoint) => { };
const validateNoFIPS = (useFipsEndpoint) => {
    if (useFipsEndpoint)
        throw new Error(`FIPS region is not supported with Outpost.`);
};
const validateMrapAlias = (name) => {
    try {
        name.split(".").forEach((label) => {
            validateDNSHostLabel(label);
        });
    }
    catch (e) {
        throw new Error(`"${name}" is not a DNS compatible name.`);
    }
};

const bucketHostname = (options) => {
    validateCustomEndpoint(options);
    return isBucketNameOptions(options)
        ?
            getEndpointFromBucketName(options)
        :
            getEndpointFromArn(options);
};
const getEndpointFromBucketName = ({ accelerateEndpoint = false, clientRegion: region, baseHostname, bucketName, dualstackEndpoint = false, fipsEndpoint = false, pathStyleEndpoint = false, tlsCompatible = true, isCustomEndpoint = false, }) => {
    const [clientRegion, hostnameSuffix] = isCustomEndpoint ? [region, baseHostname] : getSuffix(baseHostname);
    if (pathStyleEndpoint || !isDnsCompatibleBucketName(bucketName) || (tlsCompatible && DOT_PATTERN.test(bucketName))) {
        return {
            bucketEndpoint: false,
            hostname: dualstackEndpoint ? `s3.dualstack.${clientRegion}.${hostnameSuffix}` : baseHostname,
        };
    }
    if (accelerateEndpoint) {
        baseHostname = `s3-accelerate${dualstackEndpoint ? ".dualstack" : ""}.${hostnameSuffix}`;
    }
    else if (dualstackEndpoint) {
        baseHostname = `s3.dualstack.${clientRegion}.${hostnameSuffix}`;
    }
    return {
        bucketEndpoint: true,
        hostname: `${bucketName}.${baseHostname}`,
    };
};
const getEndpointFromArn = (options) => {
    const { isCustomEndpoint, baseHostname, clientRegion } = options;
    const hostnameSuffix = isCustomEndpoint ? baseHostname : getSuffixForArnEndpoint(baseHostname)[1];
    const { pathStyleEndpoint, accelerateEndpoint = false, fipsEndpoint = false, tlsCompatible = true, bucketName, clientPartition = "aws", } = options;
    validateArnEndpointOptions({ pathStyleEndpoint, accelerateEndpoint, tlsCompatible });
    const { service, partition, accountId, region, resource } = bucketName;
    validateService(service);
    validatePartition(partition, { clientPartition });
    validateAccountId(accountId);
    const { accesspointName, outpostId } = getArnResources(resource);
    if (service === "s3-object-lambda") {
        return getEndpointFromObjectLambdaArn({ ...options, tlsCompatible, bucketName, accesspointName, hostnameSuffix });
    }
    if (region === "") {
        return getEndpointFromMRAPArn({ ...options, mrapAlias: accesspointName, hostnameSuffix });
    }
    if (outpostId) {
        return getEndpointFromOutpostArn({ ...options, clientRegion, outpostId, accesspointName, hostnameSuffix });
    }
    return getEndpointFromAccessPointArn({ ...options, clientRegion, accesspointName, hostnameSuffix });
};
const getEndpointFromObjectLambdaArn = ({ dualstackEndpoint = false, fipsEndpoint = false, tlsCompatible = true, useArnRegion, clientRegion, clientSigningRegion = clientRegion, accesspointName, bucketName, hostnameSuffix, }) => {
    const { accountId, region, service } = bucketName;
    validateRegionalClient(clientRegion);
    const DNSHostLabel = `${accesspointName}-${accountId}`;
    validateDNSHostLabel(DNSHostLabel, { tlsCompatible });
    const endpointRegion = useArnRegion ? region : clientRegion;
    const signingRegion = useArnRegion ? region : clientSigningRegion;
    return {
        bucketEndpoint: true,
        hostname: `${DNSHostLabel}.${service}${fipsEndpoint ? "-fips" : ""}.${endpointRegion}.${hostnameSuffix}`,
        signingRegion,
        signingService: service,
    };
};
const getEndpointFromMRAPArn = ({ disableMultiregionAccessPoints, dualstackEndpoint = false, isCustomEndpoint, mrapAlias, hostnameSuffix, }) => {
    if (disableMultiregionAccessPoints === true) {
        throw new Error("SDK is attempting to use a MRAP ARN. Please enable to feature.");
    }
    validateMrapAlias(mrapAlias);
    return {
        bucketEndpoint: true,
        hostname: `${mrapAlias}${isCustomEndpoint ? "" : `.accesspoint.s3-global`}.${hostnameSuffix}`,
        signingRegion: "*",
    };
};
const getEndpointFromOutpostArn = ({ useArnRegion, clientRegion, clientSigningRegion = clientRegion, bucketName, outpostId, dualstackEndpoint = false, fipsEndpoint = false, tlsCompatible = true, accesspointName, isCustomEndpoint, hostnameSuffix, }) => {
    validateRegionalClient(clientRegion);
    const DNSHostLabel = `${accesspointName}-${bucketName.accountId}`;
    validateDNSHostLabel(DNSHostLabel, { tlsCompatible });
    const endpointRegion = useArnRegion ? bucketName.region : clientRegion;
    const signingRegion = useArnRegion ? bucketName.region : clientSigningRegion;
    validateOutpostService(bucketName.service);
    validateDNSHostLabel(outpostId, { tlsCompatible });
    validateNoFIPS(fipsEndpoint);
    const hostnamePrefix = `${DNSHostLabel}.${outpostId}`;
    return {
        bucketEndpoint: true,
        hostname: `${hostnamePrefix}${isCustomEndpoint ? "" : `.s3-outposts.${endpointRegion}`}.${hostnameSuffix}`,
        signingRegion,
        signingService: "s3-outposts",
    };
};
const getEndpointFromAccessPointArn = ({ useArnRegion, clientRegion, clientSigningRegion = clientRegion, bucketName, dualstackEndpoint = false, fipsEndpoint = false, tlsCompatible = true, accesspointName, isCustomEndpoint, hostnameSuffix, }) => {
    validateRegionalClient(clientRegion);
    const hostnamePrefix = `${accesspointName}-${bucketName.accountId}`;
    validateDNSHostLabel(hostnamePrefix, { tlsCompatible });
    const endpointRegion = useArnRegion ? bucketName.region : clientRegion;
    const signingRegion = useArnRegion ? bucketName.region : clientSigningRegion;
    validateS3Service(bucketName.service);
    return {
        bucketEndpoint: true,
        hostname: `${hostnamePrefix}${isCustomEndpoint
            ? ""
            : `.s3-accesspoint${fipsEndpoint ? "-fips" : ""}${dualstackEndpoint ? ".dualstack" : ""}.${endpointRegion}`}.${hostnameSuffix}`,
        signingRegion,
    };
};

const bucketEndpointMiddleware = (options) => (next, context) => async (args) => {
    const { Bucket: bucketName } = args.input;
    let replaceBucketInPath = options.bucketEndpoint;
    const request = args.request;
    if (protocolHttp.HttpRequest.isInstance(request)) {
        if (options.bucketEndpoint) {
            request.hostname = bucketName;
        }
        else if (utilArnParser.validate(bucketName)) {
            const bucketArn = utilArnParser.parse(bucketName);
            const clientRegion = await options.region();
            const useDualstackEndpoint = await options.useDualstackEndpoint();
            const useFipsEndpoint = await options.useFipsEndpoint();
            const { partition, signingRegion = clientRegion } = (await options.regionInfoProvider(clientRegion, { useDualstackEndpoint, useFipsEndpoint })) || {};
            const useArnRegion = await options.useArnRegion();
            const { hostname, bucketEndpoint, signingRegion: modifiedSigningRegion, signingService, } = bucketHostname({
                bucketName: bucketArn,
                baseHostname: request.hostname,
                accelerateEndpoint: options.useAccelerateEndpoint,
                dualstackEndpoint: useDualstackEndpoint,
                fipsEndpoint: useFipsEndpoint,
                pathStyleEndpoint: options.forcePathStyle,
                tlsCompatible: request.protocol === "https:",
                useArnRegion,
                clientPartition: partition,
                clientSigningRegion: signingRegion,
                clientRegion: clientRegion,
                isCustomEndpoint: options.isCustomEndpoint,
                disableMultiregionAccessPoints: await options.disableMultiregionAccessPoints(),
            });
            if (modifiedSigningRegion && modifiedSigningRegion !== signingRegion) {
                context["signing_region"] = modifiedSigningRegion;
            }
            if (signingService && signingService !== "s3") {
                context["signing_service"] = signingService;
            }
            request.hostname = hostname;
            replaceBucketInPath = bucketEndpoint;
        }
        else {
            const clientRegion = await options.region();
            const dualstackEndpoint = await options.useDualstackEndpoint();
            const fipsEndpoint = await options.useFipsEndpoint();
            const { hostname, bucketEndpoint } = bucketHostname({
                bucketName,
                clientRegion,
                baseHostname: request.hostname,
                accelerateEndpoint: options.useAccelerateEndpoint,
                dualstackEndpoint,
                fipsEndpoint,
                pathStyleEndpoint: options.forcePathStyle,
                tlsCompatible: request.protocol === "https:",
                isCustomEndpoint: options.isCustomEndpoint,
            });
            request.hostname = hostname;
            replaceBucketInPath = bucketEndpoint;
        }
        if (replaceBucketInPath) {
            request.path = request.path.replace(/^(\/)?[^\/]+/, "");
            if (request.path === "") {
                request.path = "/";
            }
        }
    }
    return next({ ...args, request });
};
const bucketEndpointMiddlewareOptions = {
    tags: ["BUCKET_ENDPOINT"],
    name: "bucketEndpointMiddleware",
    relation: "before",
    toMiddleware: "hostHeaderMiddleware",
    override: true,
};
const getBucketEndpointPlugin = (options) => ({
    applyToStack: (clientStack) => {
        clientStack.addRelativeTo(bucketEndpointMiddleware(options), bucketEndpointMiddlewareOptions);
    },
});

function resolveBucketEndpointConfig(input) {
    const { bucketEndpoint = false, forcePathStyle = false, useAccelerateEndpoint = false, useArnRegion, disableMultiregionAccessPoints = false, } = input;
    return Object.assign(input, {
        bucketEndpoint,
        forcePathStyle,
        useAccelerateEndpoint,
        useArnRegion: typeof useArnRegion === "function" ? useArnRegion : () => Promise.resolve(useArnRegion),
        disableMultiregionAccessPoints: typeof disableMultiregionAccessPoints === "function"
            ? disableMultiregionAccessPoints
            : () => Promise.resolve(disableMultiregionAccessPoints),
    });
}

exports.NODE_DISABLE_MULTIREGION_ACCESS_POINT_CONFIG_OPTIONS = NODE_DISABLE_MULTIREGION_ACCESS_POINT_CONFIG_OPTIONS;
exports.NODE_DISABLE_MULTIREGION_ACCESS_POINT_ENV_NAME = NODE_DISABLE_MULTIREGION_ACCESS_POINT_ENV_NAME;
exports.NODE_DISABLE_MULTIREGION_ACCESS_POINT_INI_NAME = NODE_DISABLE_MULTIREGION_ACCESS_POINT_INI_NAME;
exports.NODE_USE_ARN_REGION_CONFIG_OPTIONS = NODE_USE_ARN_REGION_CONFIG_OPTIONS;
exports.NODE_USE_ARN_REGION_ENV_NAME = NODE_USE_ARN_REGION_ENV_NAME;
exports.NODE_USE_ARN_REGION_INI_NAME = NODE_USE_ARN_REGION_INI_NAME;
exports.bucketEndpointMiddleware = bucketEndpointMiddleware;
exports.bucketEndpointMiddlewareOptions = bucketEndpointMiddlewareOptions;
exports.bucketHostname = bucketHostname;
exports.getArnResources = getArnResources;
exports.getBucketEndpointPlugin = getBucketEndpointPlugin;
exports.getSuffixForArnEndpoint = getSuffixForArnEndpoint;
exports.resolveBucketEndpointConfig = resolveBucketEndpointConfig;
exports.validateAccountId = validateAccountId;
exports.validateDNSHostLabel = validateDNSHostLabel;
exports.validateNoDualstack = validateNoDualstack;
exports.validateNoFIPS = validateNoFIPS;
exports.validateOutpostService = validateOutpostService;
exports.validatePartition = validatePartition;
exports.validateRegion = validateRegion;


/***/ }),

/***/ 10517:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var protocolHttp = __webpack_require__(29752);

function addExpectContinueMiddleware(options) {
    return (next) => async (args) => {
        const { request } = args;
        if (options.expectContinueHeader !== false &&
            protocolHttp.HttpRequest.isInstance(request) &&
            request.body &&
            options.runtime === "node" &&
            options.requestHandler?.constructor?.name !== "FetchHttpHandler") {
            let sendHeader = true;
            if (typeof options.expectContinueHeader === "number") {
                try {
                    const bodyLength = Number(request.headers?.["content-length"]) ?? options.bodyLengthChecker?.(request.body) ?? Infinity;
                    sendHeader = bodyLength >= options.expectContinueHeader;
                }
                catch (e) { }
            }
            else {
                sendHeader = !!options.expectContinueHeader;
            }
            if (sendHeader) {
                request.headers.Expect = "100-continue";
            }
        }
        return next({
            ...args,
            request,
        });
    };
}
const addExpectContinueMiddlewareOptions = {
    step: "build",
    tags: ["SET_EXPECT_HEADER", "EXPECT_HEADER"],
    name: "addExpectContinueMiddleware",
    override: true,
};
const getAddExpectContinuePlugin = (options) => ({
    applyToStack: (clientStack) => {
        clientStack.add(addExpectContinueMiddleware(options), addExpectContinueMiddlewareOptions);
    },
});

exports.addExpectContinueMiddleware = addExpectContinueMiddleware;
exports.addExpectContinueMiddlewareOptions = addExpectContinueMiddlewareOptions;
exports.getAddExpectContinuePlugin = getAddExpectContinuePlugin;


/***/ }),

/***/ 23637:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getCrc32ChecksumAlgorithmFunction = void 0;
const tslib_1 = __webpack_require__(94176);
const crc32_1 = __webpack_require__(2266);
const util_1 = __webpack_require__(15103);
const zlib = tslib_1.__importStar(__webpack_require__(38522));
class NodeCrc32 {
    checksum = 0;
    update(data) {
        this.checksum = zlib.crc32(data, this.checksum);
    }
    async digest() {
        return (0, util_1.numToUint8)(this.checksum);
    }
    reset() {
        this.checksum = 0;
    }
}
const getCrc32ChecksumAlgorithmFunction = () => {
    if (typeof zlib.crc32 === "undefined") {
        return crc32_1.AwsCrc32;
    }
    return NodeCrc32;
};
exports.getCrc32ChecksumAlgorithmFunction = getCrc32ChecksumAlgorithmFunction;


/***/ }),

/***/ 90008:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var core = __webpack_require__(39116);
var protocolHttp = __webpack_require__(29752);
var utilStream = __webpack_require__(48392);
var isArrayBuffer = __webpack_require__(93558);
var crc32c = __webpack_require__(43655);
var crc64Nvme = __webpack_require__(98950);
var getCrc32ChecksumAlgorithmFunction = __webpack_require__(23637);
var utilUtf8 = __webpack_require__(76005);
var utilMiddleware = __webpack_require__(54160);

const RequestChecksumCalculation = {
    WHEN_SUPPORTED: "WHEN_SUPPORTED",
    WHEN_REQUIRED: "WHEN_REQUIRED",
};
const DEFAULT_REQUEST_CHECKSUM_CALCULATION = RequestChecksumCalculation.WHEN_SUPPORTED;
const ResponseChecksumValidation = {
    WHEN_SUPPORTED: "WHEN_SUPPORTED",
    WHEN_REQUIRED: "WHEN_REQUIRED",
};
const DEFAULT_RESPONSE_CHECKSUM_VALIDATION = RequestChecksumCalculation.WHEN_SUPPORTED;
exports.ChecksumAlgorithm = void 0;
(function (ChecksumAlgorithm) {
    ChecksumAlgorithm["MD5"] = "MD5";
    ChecksumAlgorithm["CRC32"] = "CRC32";
    ChecksumAlgorithm["CRC32C"] = "CRC32C";
    ChecksumAlgorithm["CRC64NVME"] = "CRC64NVME";
    ChecksumAlgorithm["SHA1"] = "SHA1";
    ChecksumAlgorithm["SHA256"] = "SHA256";
})(exports.ChecksumAlgorithm || (exports.ChecksumAlgorithm = {}));
exports.ChecksumLocation = void 0;
(function (ChecksumLocation) {
    ChecksumLocation["HEADER"] = "header";
    ChecksumLocation["TRAILER"] = "trailer";
})(exports.ChecksumLocation || (exports.ChecksumLocation = {}));
const DEFAULT_CHECKSUM_ALGORITHM = exports.ChecksumAlgorithm.CRC32;

var SelectorType;
(function (SelectorType) {
    SelectorType["ENV"] = "env";
    SelectorType["CONFIG"] = "shared config entry";
})(SelectorType || (SelectorType = {}));
const stringUnionSelector = (obj, key, union, type) => {
    if (!(key in obj))
        return undefined;
    const value = obj[key].toUpperCase();
    if (!Object.values(union).includes(value)) {
        throw new TypeError(`Cannot load ${type} '${key}'. Expected one of ${Object.values(union)}, got '${obj[key]}'.`);
    }
    return value;
};

const ENV_REQUEST_CHECKSUM_CALCULATION = "AWS_REQUEST_CHECKSUM_CALCULATION";
const CONFIG_REQUEST_CHECKSUM_CALCULATION = "request_checksum_calculation";
const NODE_REQUEST_CHECKSUM_CALCULATION_CONFIG_OPTIONS = {
    environmentVariableSelector: (env) => stringUnionSelector(env, ENV_REQUEST_CHECKSUM_CALCULATION, RequestChecksumCalculation, SelectorType.ENV),
    configFileSelector: (profile) => stringUnionSelector(profile, CONFIG_REQUEST_CHECKSUM_CALCULATION, RequestChecksumCalculation, SelectorType.CONFIG),
    default: DEFAULT_REQUEST_CHECKSUM_CALCULATION,
};

const ENV_RESPONSE_CHECKSUM_VALIDATION = "AWS_RESPONSE_CHECKSUM_VALIDATION";
const CONFIG_RESPONSE_CHECKSUM_VALIDATION = "response_checksum_validation";
const NODE_RESPONSE_CHECKSUM_VALIDATION_CONFIG_OPTIONS = {
    environmentVariableSelector: (env) => stringUnionSelector(env, ENV_RESPONSE_CHECKSUM_VALIDATION, ResponseChecksumValidation, SelectorType.ENV),
    configFileSelector: (profile) => stringUnionSelector(profile, CONFIG_RESPONSE_CHECKSUM_VALIDATION, ResponseChecksumValidation, SelectorType.CONFIG),
    default: DEFAULT_RESPONSE_CHECKSUM_VALIDATION,
};

const getChecksumAlgorithmForRequest = (input, { requestChecksumRequired, requestAlgorithmMember, requestChecksumCalculation }) => {
    if (!requestAlgorithmMember) {
        return requestChecksumCalculation === RequestChecksumCalculation.WHEN_SUPPORTED || requestChecksumRequired
            ? DEFAULT_CHECKSUM_ALGORITHM
            : undefined;
    }
    if (!input[requestAlgorithmMember]) {
        return undefined;
    }
    const checksumAlgorithm = input[requestAlgorithmMember];
    return checksumAlgorithm;
};

const getChecksumLocationName = (algorithm) => algorithm === exports.ChecksumAlgorithm.MD5 ? "content-md5" : `x-amz-checksum-${algorithm.toLowerCase()}`;

const hasHeader = (header, headers) => {
    const soughtHeader = header.toLowerCase();
    for (const headerName of Object.keys(headers)) {
        if (soughtHeader === headerName.toLowerCase()) {
            return true;
        }
    }
    return false;
};

const hasHeaderWithPrefix = (headerPrefix, headers) => {
    const soughtHeaderPrefix = headerPrefix.toLowerCase();
    for (const headerName of Object.keys(headers)) {
        if (headerName.toLowerCase().startsWith(soughtHeaderPrefix)) {
            return true;
        }
    }
    return false;
};

const isStreaming = (body) => body !== undefined && typeof body !== "string" && !ArrayBuffer.isView(body) && !isArrayBuffer.isArrayBuffer(body);

const CLIENT_SUPPORTED_ALGORITHMS = [
    exports.ChecksumAlgorithm.CRC32,
    exports.ChecksumAlgorithm.CRC32C,
    exports.ChecksumAlgorithm.CRC64NVME,
    exports.ChecksumAlgorithm.SHA1,
    exports.ChecksumAlgorithm.SHA256,
];
const PRIORITY_ORDER_ALGORITHMS = [
    exports.ChecksumAlgorithm.SHA256,
    exports.ChecksumAlgorithm.SHA1,
    exports.ChecksumAlgorithm.CRC32,
    exports.ChecksumAlgorithm.CRC32C,
    exports.ChecksumAlgorithm.CRC64NVME,
];

const selectChecksumAlgorithmFunction = (checksumAlgorithm, config) => {
    const { checksumAlgorithms = {} } = config;
    switch (checksumAlgorithm) {
        case exports.ChecksumAlgorithm.MD5:
            return checksumAlgorithms?.MD5 ?? config.md5;
        case exports.ChecksumAlgorithm.CRC32:
            return checksumAlgorithms?.CRC32 ?? getCrc32ChecksumAlgorithmFunction.getCrc32ChecksumAlgorithmFunction();
        case exports.ChecksumAlgorithm.CRC32C:
            return checksumAlgorithms?.CRC32C ?? crc32c.AwsCrc32c;
        case exports.ChecksumAlgorithm.CRC64NVME:
            if (typeof crc64Nvme.crc64NvmeCrtContainer.CrtCrc64Nvme !== "function") {
                return checksumAlgorithms?.CRC64NVME ?? crc64Nvme.Crc64Nvme;
            }
            return checksumAlgorithms?.CRC64NVME ?? crc64Nvme.crc64NvmeCrtContainer.CrtCrc64Nvme;
        case exports.ChecksumAlgorithm.SHA1:
            return checksumAlgorithms?.SHA1 ?? config.sha1;
        case exports.ChecksumAlgorithm.SHA256:
            return checksumAlgorithms?.SHA256 ?? config.sha256;
        default:
            if (checksumAlgorithms?.[checksumAlgorithm]) {
                return checksumAlgorithms[checksumAlgorithm];
            }
            throw new Error(`The checksum algorithm "${checksumAlgorithm}" is not supported by the client.` +
                ` Select one of ${CLIENT_SUPPORTED_ALGORITHMS}, or provide an implementation to ` +
                ` the client constructor checksums field.`);
    }
};

const stringHasher = (checksumAlgorithmFn, body) => {
    const hash = new checksumAlgorithmFn();
    hash.update(utilUtf8.toUint8Array(body || ""));
    return hash.digest();
};

const flexibleChecksumsMiddlewareOptions = {
    name: "flexibleChecksumsMiddleware",
    step: "build",
    tags: ["BODY_CHECKSUM"],
    override: true,
};
const flexibleChecksumsMiddleware = (config, middlewareConfig) => (next, context) => async (args) => {
    if (!protocolHttp.HttpRequest.isInstance(args.request)) {
        return next(args);
    }
    if (hasHeaderWithPrefix("x-amz-checksum-", args.request.headers)) {
        return next(args);
    }
    const { request, input } = args;
    const { body: requestBody, headers } = request;
    const { base64Encoder, streamHasher } = config;
    const { requestChecksumRequired, requestAlgorithmMember } = middlewareConfig;
    const requestChecksumCalculation = await config.requestChecksumCalculation();
    const requestAlgorithmMemberName = requestAlgorithmMember?.name;
    const requestAlgorithmMemberHttpHeader = requestAlgorithmMember?.httpHeader;
    if (requestAlgorithmMemberName && !input[requestAlgorithmMemberName]) {
        if (requestChecksumCalculation === RequestChecksumCalculation.WHEN_SUPPORTED || requestChecksumRequired) {
            input[requestAlgorithmMemberName] = DEFAULT_CHECKSUM_ALGORITHM;
            if (requestAlgorithmMemberHttpHeader) {
                headers[requestAlgorithmMemberHttpHeader] = DEFAULT_CHECKSUM_ALGORITHM;
            }
        }
    }
    const checksumAlgorithm = getChecksumAlgorithmForRequest(input, {
        requestChecksumRequired,
        requestAlgorithmMember: requestAlgorithmMember?.name,
        requestChecksumCalculation,
    });
    let updatedBody = requestBody;
    let updatedHeaders = headers;
    if (checksumAlgorithm) {
        switch (checksumAlgorithm) {
            case exports.ChecksumAlgorithm.CRC32:
                core.setFeature(context, "FLEXIBLE_CHECKSUMS_REQ_CRC32", "U");
                break;
            case exports.ChecksumAlgorithm.CRC32C:
                core.setFeature(context, "FLEXIBLE_CHECKSUMS_REQ_CRC32C", "V");
                break;
            case exports.ChecksumAlgorithm.CRC64NVME:
                core.setFeature(context, "FLEXIBLE_CHECKSUMS_REQ_CRC64", "W");
                break;
            case exports.ChecksumAlgorithm.SHA1:
                core.setFeature(context, "FLEXIBLE_CHECKSUMS_REQ_SHA1", "X");
                break;
            case exports.ChecksumAlgorithm.SHA256:
                core.setFeature(context, "FLEXIBLE_CHECKSUMS_REQ_SHA256", "Y");
                break;
        }
        const checksumLocationName = getChecksumLocationName(checksumAlgorithm);
        const checksumAlgorithmFn = selectChecksumAlgorithmFunction(checksumAlgorithm, config);
        if (isStreaming(requestBody)) {
            const { getAwsChunkedEncodingStream, bodyLengthChecker } = config;
            updatedBody = getAwsChunkedEncodingStream(typeof config.requestStreamBufferSize === "number" && config.requestStreamBufferSize >= 8 * 1024
                ? utilStream.createBufferedReadable(requestBody, config.requestStreamBufferSize, context.logger)
                : requestBody, {
                base64Encoder,
                bodyLengthChecker,
                checksumLocationName,
                checksumAlgorithmFn,
                streamHasher,
            });
            updatedHeaders = {
                ...headers,
                "content-encoding": headers["content-encoding"]
                    ? `${headers["content-encoding"]},aws-chunked`
                    : "aws-chunked",
                "transfer-encoding": "chunked",
                "x-amz-decoded-content-length": headers["content-length"],
                "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
                "x-amz-trailer": checksumLocationName,
            };
            delete updatedHeaders["content-length"];
        }
        else if (!hasHeader(checksumLocationName, headers)) {
            const rawChecksum = await stringHasher(checksumAlgorithmFn, requestBody);
            updatedHeaders = {
                ...headers,
                [checksumLocationName]: base64Encoder(rawChecksum),
            };
        }
    }
    try {
        const result = await next({
            ...args,
            request: {
                ...request,
                headers: updatedHeaders,
                body: updatedBody,
            },
        });
        return result;
    }
    catch (e) {
        if (e instanceof Error && e.name === "InvalidChunkSizeError") {
            try {
                if (!e.message.endsWith(".")) {
                    e.message += ".";
                }
                e.message +=
                    " Set [requestStreamBufferSize=number e.g. 65_536] in client constructor to instruct AWS SDK to buffer your input stream.";
            }
            catch (ignored) {
            }
        }
        throw e;
    }
};

const flexibleChecksumsInputMiddlewareOptions = {
    name: "flexibleChecksumsInputMiddleware",
    toMiddleware: "serializerMiddleware",
    relation: "before",
    tags: ["BODY_CHECKSUM"],
    override: true,
};
const flexibleChecksumsInputMiddleware = (config, middlewareConfig) => (next, context) => async (args) => {
    const input = args.input;
    const { requestValidationModeMember } = middlewareConfig;
    const requestChecksumCalculation = await config.requestChecksumCalculation();
    const responseChecksumValidation = await config.responseChecksumValidation();
    switch (requestChecksumCalculation) {
        case RequestChecksumCalculation.WHEN_REQUIRED:
            core.setFeature(context, "FLEXIBLE_CHECKSUMS_REQ_WHEN_REQUIRED", "a");
            break;
        case RequestChecksumCalculation.WHEN_SUPPORTED:
            core.setFeature(context, "FLEXIBLE_CHECKSUMS_REQ_WHEN_SUPPORTED", "Z");
            break;
    }
    switch (responseChecksumValidation) {
        case ResponseChecksumValidation.WHEN_REQUIRED:
            core.setFeature(context, "FLEXIBLE_CHECKSUMS_RES_WHEN_REQUIRED", "c");
            break;
        case ResponseChecksumValidation.WHEN_SUPPORTED:
            core.setFeature(context, "FLEXIBLE_CHECKSUMS_RES_WHEN_SUPPORTED", "b");
            break;
    }
    if (requestValidationModeMember && !input[requestValidationModeMember]) {
        if (responseChecksumValidation === ResponseChecksumValidation.WHEN_SUPPORTED) {
            input[requestValidationModeMember] = "ENABLED";
        }
    }
    return next(args);
};

const getChecksumAlgorithmListForResponse = (responseAlgorithms = []) => {
    const validChecksumAlgorithms = [];
    for (const algorithm of PRIORITY_ORDER_ALGORITHMS) {
        if (!responseAlgorithms.includes(algorithm) || !CLIENT_SUPPORTED_ALGORITHMS.includes(algorithm)) {
            continue;
        }
        validChecksumAlgorithms.push(algorithm);
    }
    return validChecksumAlgorithms;
};

const isChecksumWithPartNumber = (checksum) => {
    const lastHyphenIndex = checksum.lastIndexOf("-");
    if (lastHyphenIndex !== -1) {
        const numberPart = checksum.slice(lastHyphenIndex + 1);
        if (!numberPart.startsWith("0")) {
            const number = parseInt(numberPart, 10);
            if (!isNaN(number) && number >= 1 && number <= 10000) {
                return true;
            }
        }
    }
    return false;
};

const getChecksum = async (body, { checksumAlgorithmFn, base64Encoder }) => base64Encoder(await stringHasher(checksumAlgorithmFn, body));

const validateChecksumFromResponse = async (response, { config, responseAlgorithms, logger }) => {
    const checksumAlgorithms = getChecksumAlgorithmListForResponse(responseAlgorithms);
    const { body: responseBody, headers: responseHeaders } = response;
    for (const algorithm of checksumAlgorithms) {
        const responseHeader = getChecksumLocationName(algorithm);
        const checksumFromResponse = responseHeaders[responseHeader];
        if (checksumFromResponse) {
            let checksumAlgorithmFn;
            try {
                checksumAlgorithmFn = selectChecksumAlgorithmFunction(algorithm, config);
            }
            catch (error) {
                if (algorithm === exports.ChecksumAlgorithm.CRC64NVME) {
                    logger?.warn(`Skipping ${exports.ChecksumAlgorithm.CRC64NVME} checksum validation: ${error.message}`);
                    continue;
                }
                throw error;
            }
            const { base64Encoder } = config;
            if (isStreaming(responseBody)) {
                response.body = utilStream.createChecksumStream({
                    expectedChecksum: checksumFromResponse,
                    checksumSourceLocation: responseHeader,
                    checksum: new checksumAlgorithmFn(),
                    source: responseBody,
                    base64Encoder,
                });
                return;
            }
            const checksum = await getChecksum(responseBody, { checksumAlgorithmFn, base64Encoder });
            if (checksum === checksumFromResponse) {
                break;
            }
            throw new Error(`Checksum mismatch: expected "${checksum}" but received "${checksumFromResponse}"` +
                ` in response header "${responseHeader}".`);
        }
    }
};

const flexibleChecksumsResponseMiddlewareOptions = {
    name: "flexibleChecksumsResponseMiddleware",
    toMiddleware: "deserializerMiddleware",
    relation: "after",
    tags: ["BODY_CHECKSUM"],
    override: true,
};
const flexibleChecksumsResponseMiddleware = (config, middlewareConfig) => (next, context) => async (args) => {
    if (!protocolHttp.HttpRequest.isInstance(args.request)) {
        return next(args);
    }
    const input = args.input;
    const result = await next(args);
    const response = result.response;
    const { requestValidationModeMember, responseAlgorithms } = middlewareConfig;
    if (requestValidationModeMember && input[requestValidationModeMember] === "ENABLED") {
        const { clientName, commandName } = context;
        const isS3WholeObjectMultipartGetResponseChecksum = clientName === "S3Client" &&
            commandName === "GetObjectCommand" &&
            getChecksumAlgorithmListForResponse(responseAlgorithms).every((algorithm) => {
                const responseHeader = getChecksumLocationName(algorithm);
                const checksumFromResponse = response.headers[responseHeader];
                return !checksumFromResponse || isChecksumWithPartNumber(checksumFromResponse);
            });
        if (isS3WholeObjectMultipartGetResponseChecksum) {
            return result;
        }
        await validateChecksumFromResponse(response, {
            config,
            responseAlgorithms,
            logger: context.logger,
        });
    }
    return result;
};

const getFlexibleChecksumsPlugin = (config, middlewareConfig) => ({
    applyToStack: (clientStack) => {
        clientStack.add(flexibleChecksumsMiddleware(config, middlewareConfig), flexibleChecksumsMiddlewareOptions);
        clientStack.addRelativeTo(flexibleChecksumsInputMiddleware(config, middlewareConfig), flexibleChecksumsInputMiddlewareOptions);
        clientStack.addRelativeTo(flexibleChecksumsResponseMiddleware(config, middlewareConfig), flexibleChecksumsResponseMiddlewareOptions);
    },
});

const resolveFlexibleChecksumsConfig = (input) => {
    const { requestChecksumCalculation, responseChecksumValidation, requestStreamBufferSize } = input;
    return Object.assign(input, {
        requestChecksumCalculation: utilMiddleware.normalizeProvider(requestChecksumCalculation ?? DEFAULT_REQUEST_CHECKSUM_CALCULATION),
        responseChecksumValidation: utilMiddleware.normalizeProvider(responseChecksumValidation ?? DEFAULT_RESPONSE_CHECKSUM_VALIDATION),
        requestStreamBufferSize: Number(requestStreamBufferSize ?? 0),
        checksumAlgorithms: input.checksumAlgorithms ?? {},
    });
};

exports.CONFIG_REQUEST_CHECKSUM_CALCULATION = CONFIG_REQUEST_CHECKSUM_CALCULATION;
exports.CONFIG_RESPONSE_CHECKSUM_VALIDATION = CONFIG_RESPONSE_CHECKSUM_VALIDATION;
exports.DEFAULT_CHECKSUM_ALGORITHM = DEFAULT_CHECKSUM_ALGORITHM;
exports.DEFAULT_REQUEST_CHECKSUM_CALCULATION = DEFAULT_REQUEST_CHECKSUM_CALCULATION;
exports.DEFAULT_RESPONSE_CHECKSUM_VALIDATION = DEFAULT_RESPONSE_CHECKSUM_VALIDATION;
exports.ENV_REQUEST_CHECKSUM_CALCULATION = ENV_REQUEST_CHECKSUM_CALCULATION;
exports.ENV_RESPONSE_CHECKSUM_VALIDATION = ENV_RESPONSE_CHECKSUM_VALIDATION;
exports.NODE_REQUEST_CHECKSUM_CALCULATION_CONFIG_OPTIONS = NODE_REQUEST_CHECKSUM_CALCULATION_CONFIG_OPTIONS;
exports.NODE_RESPONSE_CHECKSUM_VALIDATION_CONFIG_OPTIONS = NODE_RESPONSE_CHECKSUM_VALIDATION_CONFIG_OPTIONS;
exports.RequestChecksumCalculation = RequestChecksumCalculation;
exports.ResponseChecksumValidation = ResponseChecksumValidation;
exports.flexibleChecksumsMiddleware = flexibleChecksumsMiddleware;
exports.flexibleChecksumsMiddlewareOptions = flexibleChecksumsMiddlewareOptions;
exports.getFlexibleChecksumsPlugin = getFlexibleChecksumsPlugin;
exports.resolveFlexibleChecksumsConfig = resolveFlexibleChecksumsConfig;


/***/ }),

/***/ 25837:
/***/ ((__unused_webpack_module, exports) => {



function locationConstraintMiddleware(options) {
    return (next) => async (args) => {
        const { CreateBucketConfiguration } = args.input;
        const region = await options.region();
        if (!CreateBucketConfiguration?.LocationConstraint && !CreateBucketConfiguration?.Location) {
            if (region !== "us-east-1") {
                args.input.CreateBucketConfiguration = args.input.CreateBucketConfiguration ?? {};
                args.input.CreateBucketConfiguration.LocationConstraint = region;
            }
        }
        return next(args);
    };
}
const locationConstraintMiddlewareOptions = {
    step: "initialize",
    tags: ["LOCATION_CONSTRAINT", "CREATE_BUCKET_CONFIGURATION"],
    name: "locationConstraintMiddleware",
    override: true,
};
const getLocationConstraintPlugin = (config) => ({
    applyToStack: (clientStack) => {
        clientStack.add(locationConstraintMiddleware(config), locationConstraintMiddlewareOptions);
    },
});

exports.getLocationConstraintPlugin = getLocationConstraintPlugin;
exports.locationConstraintMiddleware = locationConstraintMiddleware;
exports.locationConstraintMiddlewareOptions = locationConstraintMiddlewareOptions;


/***/ }),

/***/ 6060:
/***/ ((__unused_webpack_module, exports) => {



function ssecMiddleware(options) {
    return (next) => async (args) => {
        const input = { ...args.input };
        const properties = [
            {
                target: "SSECustomerKey",
                hash: "SSECustomerKeyMD5",
            },
            {
                target: "CopySourceSSECustomerKey",
                hash: "CopySourceSSECustomerKeyMD5",
            },
        ];
        for (const prop of properties) {
            const value = input[prop.target];
            if (value) {
                let valueForHash;
                if (typeof value === "string") {
                    if (isValidBase64EncodedSSECustomerKey(value, options)) {
                        valueForHash = options.base64Decoder(value);
                    }
                    else {
                        valueForHash = options.utf8Decoder(value);
                        input[prop.target] = options.base64Encoder(valueForHash);
                    }
                }
                else {
                    valueForHash = ArrayBuffer.isView(value)
                        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
                        : new Uint8Array(value);
                    input[prop.target] = options.base64Encoder(valueForHash);
                }
                const hash = new options.md5();
                hash.update(valueForHash);
                input[prop.hash] = options.base64Encoder(await hash.digest());
            }
        }
        return next({
            ...args,
            input,
        });
    };
}
const ssecMiddlewareOptions = {
    name: "ssecMiddleware",
    step: "initialize",
    tags: ["SSE"],
    override: true,
};
const getSsecPlugin = (config) => ({
    applyToStack: (clientStack) => {
        clientStack.add(ssecMiddleware(config), ssecMiddlewareOptions);
    },
});
function isValidBase64EncodedSSECustomerKey(str, options) {
    const base64Regex = /^(?:[A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    if (!base64Regex.test(str))
        return false;
    try {
        const decodedBytes = options.base64Decoder(str);
        return decodedBytes.length === 32;
    }
    catch {
        return false;
    }
}

exports.getSsecPlugin = getSsecPlugin;
exports.isValidBase64EncodedSSECustomerKey = isValidBase64EncodedSSECustomerKey;
exports.ssecMiddleware = ssecMiddleware;
exports.ssecMiddlewareOptions = ssecMiddlewareOptions;


/***/ }),

/***/ 78281:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var fs = __webpack_require__(79896);
var utilUtf8 = __webpack_require__(76005);
var stream = __webpack_require__(2203);

class HashCalculator extends stream.Writable {
    hash;
    constructor(hash, options) {
        super(options);
        this.hash = hash;
    }
    _write(chunk, encoding, callback) {
        try {
            this.hash.update(utilUtf8.toUint8Array(chunk));
        }
        catch (err) {
            return callback(err);
        }
        callback();
    }
}

const fileStreamHasher = (hashCtor, fileStream) => new Promise((resolve, reject) => {
    if (!isReadStream(fileStream)) {
        reject(new Error("Unable to calculate hash for non-file streams."));
        return;
    }
    const fileStreamTee = fs.createReadStream(fileStream.path, {
        start: fileStream.start,
        end: fileStream.end,
    });
    const hash = new hashCtor();
    const hashCalculator = new HashCalculator(hash);
    fileStreamTee.pipe(hashCalculator);
    fileStreamTee.on("error", (err) => {
        hashCalculator.end();
        reject(err);
    });
    hashCalculator.on("error", reject);
    hashCalculator.on("finish", function () {
        hash.digest().then(resolve).catch(reject);
    });
});
const isReadStream = (stream) => typeof stream.path === "string";

const readableStreamHasher = (hashCtor, readableStream) => {
    if (readableStream.readableFlowing !== null) {
        throw new Error("Unable to calculate hash for flowing readable stream");
    }
    const hash = new hashCtor();
    const hashCalculator = new HashCalculator(hash);
    readableStream.pipe(hashCalculator);
    return new Promise((resolve, reject) => {
        readableStream.on("error", (err) => {
            hashCalculator.end();
            reject(err);
        });
        hashCalculator.on("error", reject);
        hashCalculator.on("finish", () => {
            hash.digest().then(resolve).catch(reject);
        });
    });
};

exports.fileStreamHasher = fileStreamHasher;
exports.readableStreamHasher = readableStreamHasher;


/***/ }),

/***/ 89766:
/***/ ((__unused_webpack_module, exports) => {



const getCircularReplacer = () => {
    const seen = new WeakSet();
    return (key, value) => {
        if (typeof value === "object" && value !== null) {
            if (seen.has(value)) {
                return "[Circular]";
            }
            seen.add(value);
        }
        return value;
    };
};

const sleep = (seconds) => {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
};

const waiterServiceDefaults = {
    minDelay: 2,
    maxDelay: 120,
};
exports.WaiterState = void 0;
(function (WaiterState) {
    WaiterState["ABORTED"] = "ABORTED";
    WaiterState["FAILURE"] = "FAILURE";
    WaiterState["SUCCESS"] = "SUCCESS";
    WaiterState["RETRY"] = "RETRY";
    WaiterState["TIMEOUT"] = "TIMEOUT";
})(exports.WaiterState || (exports.WaiterState = {}));
const checkExceptions = (result) => {
    if (result.state === exports.WaiterState.ABORTED) {
        const abortError = new Error(`${JSON.stringify({
            ...result,
            reason: "Request was aborted",
        }, getCircularReplacer())}`);
        abortError.name = "AbortError";
        throw abortError;
    }
    else if (result.state === exports.WaiterState.TIMEOUT) {
        const timeoutError = new Error(`${JSON.stringify({
            ...result,
            reason: "Waiter has timed out",
        }, getCircularReplacer())}`);
        timeoutError.name = "TimeoutError";
        throw timeoutError;
    }
    else if (result.state !== exports.WaiterState.SUCCESS) {
        throw new Error(`${JSON.stringify(result, getCircularReplacer())}`);
    }
    return result;
};

const exponentialBackoffWithJitter = (minDelay, maxDelay, attemptCeiling, attempt) => {
    if (attempt > attemptCeiling)
        return maxDelay;
    const delay = minDelay * 2 ** (attempt - 1);
    return randomInRange(minDelay, delay);
};
const randomInRange = (min, max) => min + Math.random() * (max - min);
const runPolling = async ({ minDelay, maxDelay, maxWaitTime, abortController, client, abortSignal }, input, acceptorChecks) => {
    const observedResponses = {};
    const { state, reason } = await acceptorChecks(client, input);
    if (reason) {
        const message = createMessageFromResponse(reason);
        observedResponses[message] |= 0;
        observedResponses[message] += 1;
    }
    if (state !== exports.WaiterState.RETRY) {
        return { state, reason, observedResponses };
    }
    let currentAttempt = 1;
    const waitUntil = Date.now() + maxWaitTime * 1000;
    const attemptCeiling = Math.log(maxDelay / minDelay) / Math.log(2) + 1;
    while (true) {
        if (abortController?.signal?.aborted || abortSignal?.aborted) {
            const message = "AbortController signal aborted.";
            observedResponses[message] |= 0;
            observedResponses[message] += 1;
            return { state: exports.WaiterState.ABORTED, observedResponses };
        }
        const delay = exponentialBackoffWithJitter(minDelay, maxDelay, attemptCeiling, currentAttempt);
        if (Date.now() + delay * 1000 > waitUntil) {
            return { state: exports.WaiterState.TIMEOUT, observedResponses };
        }
        await sleep(delay);
        const { state, reason } = await acceptorChecks(client, input);
        if (reason) {
            const message = createMessageFromResponse(reason);
            observedResponses[message] |= 0;
            observedResponses[message] += 1;
        }
        if (state !== exports.WaiterState.RETRY) {
            return { state, reason, observedResponses };
        }
        currentAttempt += 1;
    }
};
const createMessageFromResponse = (reason) => {
    if (reason?.$responseBodyText) {
        return `Deserialization error for body: ${reason.$responseBodyText}`;
    }
    if (reason?.$metadata?.httpStatusCode) {
        if (reason.$response || reason.message) {
            return `${reason.$response.statusCode ?? reason.$metadata.httpStatusCode ?? "Unknown"}: ${reason.message}`;
        }
        return `${reason.$metadata.httpStatusCode}: OK`;
    }
    return String(reason?.message ?? JSON.stringify(reason, getCircularReplacer()) ?? "Unknown");
};

const validateWaiterOptions = (options) => {
    if (options.maxWaitTime <= 0) {
        throw new Error(`WaiterConfiguration.maxWaitTime must be greater than 0`);
    }
    else if (options.minDelay <= 0) {
        throw new Error(`WaiterConfiguration.minDelay must be greater than 0`);
    }
    else if (options.maxDelay <= 0) {
        throw new Error(`WaiterConfiguration.maxDelay must be greater than 0`);
    }
    else if (options.maxWaitTime <= options.minDelay) {
        throw new Error(`WaiterConfiguration.maxWaitTime [${options.maxWaitTime}] must be greater than WaiterConfiguration.minDelay [${options.minDelay}] for this waiter`);
    }
    else if (options.maxDelay < options.minDelay) {
        throw new Error(`WaiterConfiguration.maxDelay [${options.maxDelay}] must be greater than WaiterConfiguration.minDelay [${options.minDelay}] for this waiter`);
    }
};

const abortTimeout = (abortSignal) => {
    let onAbort;
    const promise = new Promise((resolve) => {
        onAbort = () => resolve({ state: exports.WaiterState.ABORTED });
        if (typeof abortSignal.addEventListener === "function") {
            abortSignal.addEventListener("abort", onAbort);
        }
        else {
            abortSignal.onabort = onAbort;
        }
    });
    return {
        clearListener() {
            if (typeof abortSignal.removeEventListener === "function") {
                abortSignal.removeEventListener("abort", onAbort);
            }
        },
        aborted: promise,
    };
};
const createWaiter = async (options, input, acceptorChecks) => {
    const params = {
        ...waiterServiceDefaults,
        ...options,
    };
    validateWaiterOptions(params);
    const exitConditions = [runPolling(params, input, acceptorChecks)];
    const finalize = [];
    if (options.abortSignal) {
        const { aborted, clearListener } = abortTimeout(options.abortSignal);
        finalize.push(clearListener);
        exitConditions.push(aborted);
    }
    if (options.abortController?.signal) {
        const { aborted, clearListener } = abortTimeout(options.abortController.signal);
        finalize.push(clearListener);
        exitConditions.push(aborted);
    }
    return Promise.race(exitConditions).then((result) => {
        for (const fn of finalize) {
            fn();
        }
        return result;
    });
};

exports.checkExceptions = checkExceptions;
exports.createWaiter = createWaiter;
exports.waiterServiceDefaults = waiterServiceDefaults;


/***/ }),

/***/ 85754:
/***/ ((module) => {

module.exports = /*#__PURE__*/JSON.parse('{"name":"@aws-sdk/client-s3","description":"AWS SDK for JavaScript S3 Client for Node.js, Browser and React Native","version":"3.1004.0","scripts":{"build":"concurrently \'yarn:build:types\' \'yarn:build:es\' && yarn build:cjs","build:cjs":"node ../../scripts/compilation/inline client-s3","build:es":"tsc -p tsconfig.es.json","build:include:deps":"yarn g:turbo run build -F=\\"$npm_package_name\\"","build:types":"tsc -p tsconfig.types.json","build:types:downlevel":"downlevel-dts dist-types dist-types/ts3.4","clean":"premove dist-cjs dist-es dist-types tsconfig.cjs.tsbuildinfo tsconfig.es.tsbuildinfo tsconfig.types.tsbuildinfo","extract:docs":"api-extractor run --local","generate:client":"node ../../scripts/generate-clients/single-service --solo s3","test":"yarn g:vitest run","test:browser":"node ./test/browser-build/esbuild && yarn g:vitest run -c vitest.config.browser.mts","test:browser:watch":"node ./test/browser-build/esbuild && yarn g:vitest watch -c vitest.config.browser.mts","test:e2e":"yarn g:vitest run -c vitest.config.e2e.mts && yarn test:browser","test:e2e:watch":"yarn g:vitest watch -c vitest.config.e2e.mts","test:index":"tsc --noEmit ./test/index-types.ts && node ./test/index-objects.spec.mjs","test:integration":"yarn g:vitest run -c vitest.config.integ.mts","test:integration:watch":"yarn g:vitest watch -c vitest.config.integ.mts","test:watch":"yarn g:vitest watch"},"main":"./dist-cjs/index.js","types":"./dist-types/index.d.ts","module":"./dist-es/index.js","sideEffects":false,"dependencies":{"@aws-crypto/sha1-browser":"5.2.0","@aws-crypto/sha256-browser":"5.2.0","@aws-crypto/sha256-js":"5.2.0","@aws-sdk/core":"^3.973.18","@aws-sdk/credential-provider-node":"^3.972.18","@aws-sdk/middleware-bucket-endpoint":"^3.972.7","@aws-sdk/middleware-expect-continue":"^3.972.7","@aws-sdk/middleware-flexible-checksums":"^3.973.4","@aws-sdk/middleware-host-header":"^3.972.7","@aws-sdk/middleware-location-constraint":"^3.972.7","@aws-sdk/middleware-logger":"^3.972.7","@aws-sdk/middleware-recursion-detection":"^3.972.7","@aws-sdk/middleware-sdk-s3":"^3.972.18","@aws-sdk/middleware-ssec":"^3.972.7","@aws-sdk/middleware-user-agent":"^3.972.19","@aws-sdk/region-config-resolver":"^3.972.7","@aws-sdk/signature-v4-multi-region":"^3.996.6","@aws-sdk/types":"^3.973.5","@aws-sdk/util-endpoints":"^3.996.4","@aws-sdk/util-user-agent-browser":"^3.972.7","@aws-sdk/util-user-agent-node":"^3.973.4","@smithy/config-resolver":"^4.4.10","@smithy/core":"^3.23.8","@smithy/eventstream-serde-browser":"^4.2.11","@smithy/eventstream-serde-config-resolver":"^4.3.11","@smithy/eventstream-serde-node":"^4.2.11","@smithy/fetch-http-handler":"^5.3.13","@smithy/hash-blob-browser":"^4.2.12","@smithy/hash-node":"^4.2.11","@smithy/hash-stream-node":"^4.2.11","@smithy/invalid-dependency":"^4.2.11","@smithy/md5-js":"^4.2.11","@smithy/middleware-content-length":"^4.2.11","@smithy/middleware-endpoint":"^4.4.22","@smithy/middleware-retry":"^4.4.39","@smithy/middleware-serde":"^4.2.12","@smithy/middleware-stack":"^4.2.11","@smithy/node-config-provider":"^4.3.11","@smithy/node-http-handler":"^4.4.14","@smithy/protocol-http":"^5.3.11","@smithy/smithy-client":"^4.12.2","@smithy/types":"^4.13.0","@smithy/url-parser":"^4.2.11","@smithy/util-base64":"^4.3.2","@smithy/util-body-length-browser":"^4.2.2","@smithy/util-body-length-node":"^4.2.3","@smithy/util-defaults-mode-browser":"^4.3.38","@smithy/util-defaults-mode-node":"^4.2.41","@smithy/util-endpoints":"^3.3.2","@smithy/util-middleware":"^4.2.11","@smithy/util-retry":"^4.2.11","@smithy/util-stream":"^4.5.17","@smithy/util-utf8":"^4.2.2","@smithy/util-waiter":"^4.2.11","tslib":"^2.6.2"},"devDependencies":{"@aws-sdk/signature-v4-crt":"3.1004.0","@smithy/snapshot-testing":"^1.0.9","@tsconfig/node20":"20.1.8","@types/node":"^20.14.8","concurrently":"7.0.0","downlevel-dts":"0.10.1","premove":"4.0.0","typescript":"~5.8.3","vitest":"^4.0.17"},"engines":{"node":">=20.0.0"},"typesVersions":{"<4.5":{"dist-types/*":["dist-types/ts3.4/*"]}},"files":["dist-*/**"],"author":{"name":"AWS SDK for JavaScript Team","url":"https://aws.amazon.com/javascript/"},"license":"Apache-2.0","browser":{"./dist-es/runtimeConfig":"./dist-es/runtimeConfig.browser"},"react-native":{"./dist-es/runtimeConfig":"./dist-es/runtimeConfig.native"},"homepage":"https://github.com/aws/aws-sdk-js-v3/tree/main/clients/client-s3","repository":{"type":"git","url":"https://github.com/aws/aws-sdk-js-v3.git","directory":"clients/client-s3"}}');

/***/ })

};

//# sourceMappingURL=299.index.js.map