export const id = 613;
export const ids = [613];
export const modules = {

/***/ 82613:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var utilFormatUrl = __webpack_require__(14939);
var middlewareEndpoint = __webpack_require__(10775);
var protocolHttp = __webpack_require__(29752);
var signatureV4MultiRegion = __webpack_require__(96861);

const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
const SHA256_HEADER = "X-Amz-Content-Sha256";

class S3RequestPresigner {
    signer;
    constructor(options) {
        const resolvedOptions = {
            service: options.signingName || options.service || "s3",
            uriEscapePath: options.uriEscapePath || false,
            applyChecksum: options.applyChecksum || false,
            ...options,
        };
        this.signer = new signatureV4MultiRegion.SignatureV4MultiRegion(resolvedOptions);
    }
    presign(requestToSign, { unsignableHeaders = new Set(), hoistableHeaders = new Set(), unhoistableHeaders = new Set(), ...options } = {}) {
        this.prepareRequest(requestToSign, {
            unsignableHeaders,
            unhoistableHeaders,
            hoistableHeaders,
        });
        return this.signer.presign(requestToSign, {
            expiresIn: 900,
            unsignableHeaders,
            unhoistableHeaders,
            ...options,
        });
    }
    presignWithCredentials(requestToSign, credentials, { unsignableHeaders = new Set(), hoistableHeaders = new Set(), unhoistableHeaders = new Set(), ...options } = {}) {
        this.prepareRequest(requestToSign, {
            unsignableHeaders,
            unhoistableHeaders,
            hoistableHeaders,
        });
        return this.signer.presignWithCredentials(requestToSign, credentials, {
            expiresIn: 900,
            unsignableHeaders,
            unhoistableHeaders,
            ...options,
        });
    }
    prepareRequest(requestToSign, { unsignableHeaders = new Set(), unhoistableHeaders = new Set(), hoistableHeaders = new Set(), } = {}) {
        unsignableHeaders.add("content-type");
        Object.keys(requestToSign.headers)
            .map((header) => header.toLowerCase())
            .filter((header) => header.startsWith("x-amz-server-side-encryption"))
            .forEach((header) => {
            if (!hoistableHeaders.has(header)) {
                unhoistableHeaders.add(header);
            }
        });
        requestToSign.headers[SHA256_HEADER] = UNSIGNED_PAYLOAD;
        const currentHostHeader = requestToSign.headers.host;
        const port = requestToSign.port;
        const expectedHostHeader = `${requestToSign.hostname}${requestToSign.port != null ? ":" + port : ""}`;
        if (!currentHostHeader || (currentHostHeader === requestToSign.hostname && requestToSign.port != null)) {
            requestToSign.headers.host = expectedHostHeader;
        }
    }
}

const getSignedUrl = async (client, command, options = {}) => {
    let s3Presigner;
    let region;
    if (typeof client.config.endpointProvider === "function") {
        const endpointV2 = await middlewareEndpoint.getEndpointFromInstructions(command.input, command.constructor, client.config);
        const authScheme = endpointV2.properties?.authSchemes?.[0];
        if (authScheme?.name === "sigv4a") {
            region = authScheme?.signingRegionSet?.join(",");
        }
        else {
            region = authScheme?.signingRegion;
        }
        s3Presigner = new S3RequestPresigner({
            ...client.config,
            signingName: authScheme?.signingName,
            region: async () => region,
        });
    }
    else {
        s3Presigner = new S3RequestPresigner(client.config);
    }
    const presignInterceptMiddleware = (next, context) => async (args) => {
        const { request } = args;
        if (!protocolHttp.HttpRequest.isInstance(request)) {
            throw new Error("Request to be presigned is not an valid HTTP request.");
        }
        delete request.headers["amz-sdk-invocation-id"];
        delete request.headers["amz-sdk-request"];
        delete request.headers["x-amz-user-agent"];
        let presigned;
        const presignerOptions = {
            ...options,
            signingRegion: options.signingRegion ?? context["signing_region"] ?? region,
            signingService: options.signingService ?? context["signing_service"],
        };
        if (context.s3ExpressIdentity) {
            presigned = await s3Presigner.presignWithCredentials(request, context.s3ExpressIdentity, presignerOptions);
        }
        else {
            presigned = await s3Presigner.presign(request, presignerOptions);
        }
        return {
            response: {},
            output: {
                $metadata: { httpStatusCode: 200 },
                presigned,
            },
        };
    };
    const middlewareName = "presignInterceptMiddleware";
    const clientStack = client.middlewareStack.clone();
    clientStack.addRelativeTo(presignInterceptMiddleware, {
        name: middlewareName,
        relation: "before",
        toMiddleware: "awsAuthMiddleware",
        override: true,
    });
    const handler = command.resolveMiddleware(clientStack, client.config, {});
    const { output } = await handler({ input: command.input });
    const { presigned } = output;
    return utilFormatUrl.formatUrl(presigned);
};

exports.S3RequestPresigner = S3RequestPresigner;
exports.getSignedUrl = getSignedUrl;


/***/ }),

/***/ 14939:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {



var querystringBuilder = __webpack_require__(51556);

function formatUrl(request) {
    const { port, query } = request;
    let { protocol, path, hostname } = request;
    if (protocol && protocol.slice(-1) !== ":") {
        protocol += ":";
    }
    if (port) {
        hostname += `:${port}`;
    }
    if (path && path.charAt(0) !== "/") {
        path = `/${path}`;
    }
    let queryString = query ? querystringBuilder.buildQueryString(query) : "";
    if (queryString && queryString[0] !== "?") {
        queryString = `?${queryString}`;
    }
    let auth = "";
    if (request.username != null || request.password != null) {
        const username = request.username ?? "";
        const password = request.password ?? "";
        auth = `${username}:${password}@`;
    }
    let fragment = "";
    if (request.fragment) {
        fragment = `#${request.fragment}`;
    }
    return `${protocol}//${auth}${hostname}${path}${queryString}${fragment}`;
}

exports.formatUrl = formatUrl;


/***/ })

};

//# sourceMappingURL=613.index.js.map