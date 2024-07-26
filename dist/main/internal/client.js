"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var crypto = _interopRequireWildcard(require("crypto"), true);
var fs = _interopRequireWildcard(require("fs"), true);
var http = _interopRequireWildcard(require("http"), true);
var https = _interopRequireWildcard(require("https"), true);
var path = _interopRequireWildcard(require("path"), true);
var stream = _interopRequireWildcard(require("stream"), true);
var async = _interopRequireWildcard(require("async"), true);
var _blockStream = require("block-stream2");
var _browserOrNode = require("browser-or-node");
var _lodash = require("lodash");
var qs = _interopRequireWildcard(require("query-string"), true);
var _xml2js = require("xml2js");
var _CredentialProvider = require("../CredentialProvider.js");
var errors = _interopRequireWildcard(require("../errors.js"), true);
var _helpers = require("../helpers.js");
var _signing = require("../signing.js");
var _async2 = require("./async.js");
var _copyConditions = require("./copy-conditions.js");
var _extensions = require("./extensions.js");
var _helper = require("./helper.js");
var _joinHostPort = require("./join-host-port.js");
var _postPolicy = require("./post-policy.js");
var _request = require("./request.js");
var _response = require("./response.js");
var _s3Endpoints = require("./s3-endpoints.js");
var xmlParsers = _interopRequireWildcard(require("./xml-parser.js"), true);
function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }
function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }
const xml = new _xml2js.Builder({
  renderOpts: {
    pretty: false
  },
  headless: true
});

// will be replaced by bundler.
const Package = {
  version: "8.0.2" || 'development'
};
const requestOptionProperties = ['agent', 'ca', 'cert', 'ciphers', 'clientCertEngine', 'crl', 'dhparam', 'ecdhCurve', 'family', 'honorCipherOrder', 'key', 'passphrase', 'pfx', 'rejectUnauthorized', 'secureOptions', 'secureProtocol', 'servername', 'sessionIdContext'];
class TypedClient {
  partSize = 64 * 1024 * 1024;
  maximumPartSize = 5 * 1024 * 1024 * 1024;
  maxObjectSize = 5 * 1024 * 1024 * 1024 * 1024;
  constructor(params) {
    // @ts-expect-error deprecated property
    if (params.secure !== undefined) {
      throw new Error('"secure" option deprecated, "useSSL" should be used instead');
    }
    // Default values if not specified.
    if (params.useSSL === undefined) {
      params.useSSL = true;
    }
    if (!params.port) {
      params.port = 0;
    }
    // Validate input params.
    if (!(0, _helper.isValidEndpoint)(params.endPoint)) {
      throw new errors.InvalidEndpointError(`Invalid endPoint : ${params.endPoint}`);
    }
    if (!(0, _helper.isValidPort)(params.port)) {
      throw new errors.InvalidArgumentError(`Invalid port : ${params.port}`);
    }
    if (!(0, _helper.isBoolean)(params.useSSL)) {
      throw new errors.InvalidArgumentError(`Invalid useSSL flag type : ${params.useSSL}, expected to be of type "boolean"`);
    }

    // Validate region only if its set.
    if (params.region) {
      if (!(0, _helper.isString)(params.region)) {
        throw new errors.InvalidArgumentError(`Invalid region : ${params.region}`);
      }
    }
    const host = params.endPoint.toLowerCase();
    let port = params.port;
    let protocol;
    let transport;
    let transportAgent;
    // Validate if configuration is not using SSL
    // for constructing relevant endpoints.
    if (params.useSSL) {
      // Defaults to secure.
      transport = https;
      protocol = 'https:';
      port = port || 443;
      transportAgent = https.globalAgent;
    } else {
      transport = http;
      protocol = 'http:';
      port = port || 80;
      transportAgent = http.globalAgent;
    }

    // if custom transport is set, use it.
    if (params.transport) {
      if (!(0, _helper.isObject)(params.transport)) {
        throw new errors.InvalidArgumentError(`Invalid transport type : ${params.transport}, expected to be type "object"`);
      }
      transport = params.transport;
    }

    // if custom transport agent is set, use it.
    if (params.transportAgent) {
      if (!(0, _helper.isObject)(params.transportAgent)) {
        throw new errors.InvalidArgumentError(`Invalid transportAgent type: ${params.transportAgent}, expected to be type "object"`);
      }
      transportAgent = params.transportAgent;
    }

    // User Agent should always following the below style.
    // Please open an issue to discuss any new changes here.
    //
    //       MinIO (OS; ARCH) LIB/VER APP/VER
    //
    const libraryComments = `(${process.platform}; ${process.arch})`;
    const libraryAgent = `MinIO ${libraryComments} minio-js/${Package.version}`;
    // User agent block ends.

    this.transport = transport;
    this.transportAgent = transportAgent;
    this.host = host;
    this.port = port;
    this.protocol = protocol;
    this.userAgent = `${libraryAgent}`;

    // Default path style is true
    if (params.pathStyle === undefined) {
      this.pathStyle = true;
    } else {
      this.pathStyle = params.pathStyle;
    }
    this.accessKey = params.accessKey ?? '';
    this.secretKey = params.secretKey ?? '';
    this.sessionToken = params.sessionToken;
    this.anonymous = !this.accessKey || !this.secretKey;
    if (params.credentialsProvider) {
      this.credentialsProvider = params.credentialsProvider;
    }
    this.regionMap = {};
    if (params.region) {
      this.region = params.region;
    }
    if (params.partSize) {
      this.partSize = params.partSize;
      this.overRidePartSize = true;
    }
    if (this.partSize < 5 * 1024 * 1024) {
      throw new errors.InvalidArgumentError(`Part size should be greater than 5MB`);
    }
    if (this.partSize > 5 * 1024 * 1024 * 1024) {
      throw new errors.InvalidArgumentError(`Part size should be less than 5GB`);
    }

    // SHA256 is enabled only for authenticated http requests. If the request is authenticated
    // and the connection is https we use x-amz-content-sha256=UNSIGNED-PAYLOAD
    // header for signature calculation.
    this.enableSHA256 = !this.anonymous && !params.useSSL;
    this.s3AccelerateEndpoint = params.s3AccelerateEndpoint || undefined;
    this.reqOptions = {};
    this.clientExtensions = new _extensions.Extensions(this);
  }
  /**
   * Minio extensions that aren't necessary present for Amazon S3 compatible storage servers
   */
  get extensions() {
    return this.clientExtensions;
  }

  /**
   * @param endPoint - valid S3 acceleration end point
   */
  setS3TransferAccelerate(endPoint) {
    this.s3AccelerateEndpoint = endPoint;
  }

  /**
   * Sets the supported request options.
   */
  setRequestOptions(options) {
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('request options should be of type "object"');
    }
    this.reqOptions = _lodash.pick(options, requestOptionProperties);
  }

  /**
   *  This is s3 Specific and does not hold validity in any other Object storage.
   */
  getAccelerateEndPointIfSet(bucketName, objectName) {
    if (!(0, _helper.isEmpty)(this.s3AccelerateEndpoint) && !(0, _helper.isEmpty)(bucketName) && !(0, _helper.isEmpty)(objectName)) {
      // http://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html
      // Disable transfer acceleration for non-compliant bucket names.
      if (bucketName.includes('.')) {
        throw new Error(`Transfer Acceleration is not supported for non compliant bucket:${bucketName}`);
      }
      // If transfer acceleration is requested set new host.
      // For more details about enabling transfer acceleration read here.
      // http://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html
      return this.s3AccelerateEndpoint;
    }
    return false;
  }

  /**
   *   Set application specific information.
   *   Generates User-Agent in the following style.
   *   MinIO (OS; ARCH) LIB/VER APP/VER
   */
  setAppInfo(appName, appVersion) {
    if (!(0, _helper.isString)(appName)) {
      throw new TypeError(`Invalid appName: ${appName}`);
    }
    if (appName.trim() === '') {
      throw new errors.InvalidArgumentError('Input appName cannot be empty.');
    }
    if (!(0, _helper.isString)(appVersion)) {
      throw new TypeError(`Invalid appVersion: ${appVersion}`);
    }
    if (appVersion.trim() === '') {
      throw new errors.InvalidArgumentError('Input appVersion cannot be empty.');
    }
    this.userAgent = `${this.userAgent} ${appName}/${appVersion}`;
  }

  /**
   * returns options object that can be used with http.request()
   * Takes care of constructing virtual-host-style or path-style hostname
   */
  getRequestOptions(opts) {
    const method = opts.method;
    const region = opts.region;
    const bucketName = opts.bucketName;
    let objectName = opts.objectName;
    const headers = opts.headers;
    const query = opts.query;
    let reqOptions = {
      method,
      headers: {},
      protocol: this.protocol,
      // If custom transportAgent was supplied earlier, we'll inject it here
      agent: this.transportAgent
    };

    // Verify if virtual host supported.
    let virtualHostStyle;
    if (bucketName) {
      virtualHostStyle = (0, _helper.isVirtualHostStyle)(this.host, this.protocol, bucketName, this.pathStyle);
    }
    let path = '/';
    let host = this.host;
    let port;
    if (this.port) {
      port = this.port;
    }
    if (objectName) {
      objectName = (0, _helper.uriResourceEscape)(objectName);
    }

    // For Amazon S3 endpoint, get endpoint based on region.
    if ((0, _helper.isAmazonEndpoint)(host)) {
      const accelerateEndPoint = this.getAccelerateEndPointIfSet(bucketName, objectName);
      if (accelerateEndPoint) {
        host = `${accelerateEndPoint}`;
      } else {
        host = (0, _s3Endpoints.getS3Endpoint)(region);
      }
    }
    if (virtualHostStyle && !opts.pathStyle) {
      // For all hosts which support virtual host style, `bucketName`
      // is part of the hostname in the following format:
      //
      //  var host = 'bucketName.example.com'
      //
      if (bucketName) {
        host = `${bucketName}.${host}`;
      }
      if (objectName) {
        path = `/${objectName}`;
      }
    } else {
      // For all S3 compatible storage services we will fallback to
      // path style requests, where `bucketName` is part of the URI
      // path.
      if (bucketName) {
        path = `/${bucketName}`;
      }
      if (objectName) {
        path = `/${bucketName}/${objectName}`;
      }
    }
    if (query) {
      path += `?${query}`;
    }
    reqOptions.headers.host = host;
    if (reqOptions.protocol === 'http:' && port !== 80 || reqOptions.protocol === 'https:' && port !== 443) {
      reqOptions.headers.host = (0, _joinHostPort.joinHostPort)(host, port);
    }
    reqOptions.headers['user-agent'] = this.userAgent;
    if (headers) {
      // have all header keys in lower case - to make signing easy
      for (const [k, v] of Object.entries(headers)) {
        reqOptions.headers[k.toLowerCase()] = v;
      }
    }

    // Use any request option specified in minioClient.setRequestOptions()
    reqOptions = Object.assign({}, this.reqOptions, reqOptions);
    return {
      ...reqOptions,
      headers: _lodash.mapValues(_lodash.pickBy(reqOptions.headers, _helper.isDefined), v => v.toString()),
      host,
      port,
      path
    };
  }
  async setCredentialsProvider(credentialsProvider) {
    if (!(credentialsProvider instanceof _CredentialProvider.CredentialProvider)) {
      throw new Error('Unable to get credentials. Expected instance of CredentialProvider');
    }
    this.credentialsProvider = credentialsProvider;
    await this.checkAndRefreshCreds();
  }
  async checkAndRefreshCreds() {
    if (this.credentialsProvider) {
      try {
        const credentialsConf = await this.credentialsProvider.getCredentials();
        this.accessKey = credentialsConf.getAccessKey();
        this.secretKey = credentialsConf.getSecretKey();
        this.sessionToken = credentialsConf.getSessionToken();
      } catch (e) {
        throw new Error(`Unable to get credentials: ${e}`, {
          cause: e
        });
      }
    }
  }
  /**
   * log the request, response, error
   */
  logHTTP(reqOptions, response, err) {
    // if no logStream available return.
    if (!this.logStream) {
      return;
    }
    if (!(0, _helper.isObject)(reqOptions)) {
      throw new TypeError('reqOptions should be of type "object"');
    }
    if (response && !(0, _helper.isReadableStream)(response)) {
      throw new TypeError('response should be of type "Stream"');
    }
    if (err && !(err instanceof Error)) {
      throw new TypeError('err should be of type "Error"');
    }
    const logStream = this.logStream;
    const logHeaders = headers => {
      Object.entries(headers).forEach(([k, v]) => {
        if (k == 'authorization') {
          if ((0, _helper.isString)(v)) {
            const redactor = new RegExp('Signature=([0-9a-f]+)');
            v = v.replace(redactor, 'Signature=**REDACTED**');
          }
        }
        logStream.write(`${k}: ${v}\n`);
      });
      logStream.write('\n');
    };
    logStream.write(`REQUEST: ${reqOptions.method} ${reqOptions.path}\n`);
    logHeaders(reqOptions.headers);
    if (response) {
      this.logStream.write(`RESPONSE: ${response.statusCode}\n`);
      logHeaders(response.headers);
    }
    if (err) {
      logStream.write('ERROR BODY:\n');
      const errJSON = JSON.stringify(err, null, '\t');
      logStream.write(`${errJSON}\n`);
    }
  }

  /**
   * Enable tracing
   */
  traceOn(stream) {
    if (!stream) {
      stream = process.stdout;
    }
    this.logStream = stream;
  }

  /**
   * Disable tracing
   */
  traceOff() {
    this.logStream = undefined;
  }

  /**
   * makeRequest is the primitive used by the apis for making S3 requests.
   * payload can be empty string in case of no payload.
   * statusCode is the expected statusCode. If response.statusCode does not match
   * we parse the XML error and call the callback with the error message.
   *
   * A valid region is passed by the calls - listBuckets, makeBucket and getBucketRegion.
   *
   * @internal
   */
  async makeRequestAsync(options, payload = '', expectedCodes = [200], region = '') {
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(0, _helper.isString)(payload) && !(0, _helper.isObject)(payload)) {
      // Buffer is of type 'object'
      throw new TypeError('payload should be of type "string" or "Buffer"');
    }
    expectedCodes.forEach(statusCode => {
      if (!(0, _helper.isNumber)(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!(0, _helper.isString)(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!options.headers) {
      options.headers = {};
    }
    if (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE') {
      options.headers['content-length'] = payload.length.toString();
    }
    const sha256sum = this.enableSHA256 ? (0, _helper.toSha256)(payload) : '';
    return this.makeRequestStreamAsync(options, payload, sha256sum, expectedCodes, region);
  }

  /**
   * new request with promise
   *
   * No need to drain response, response body is not valid
   */
  async makeRequestAsyncOmit(options, payload = '', statusCodes = [200], region = '') {
    const res = await this.makeRequestAsync(options, payload, statusCodes, region);
    await (0, _response.drainResponse)(res);
    return res;
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @internal
   */
  async makeRequestStreamAsync(options, body, sha256sum, statusCodes, region) {
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(Buffer.isBuffer(body) || typeof body === 'string' || (0, _helper.isReadableStream)(body))) {
      throw new errors.InvalidArgumentError(`stream should be a Buffer, string or readable Stream, got ${typeof body} instead`);
    }
    if (!(0, _helper.isString)(sha256sum)) {
      throw new TypeError('sha256sum should be of type "string"');
    }
    statusCodes.forEach(statusCode => {
      if (!(0, _helper.isNumber)(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!(0, _helper.isString)(region)) {
      throw new TypeError('region should be of type "string"');
    }
    // sha256sum will be empty for anonymous or https requests
    if (!this.enableSHA256 && sha256sum.length !== 0) {
      throw new errors.InvalidArgumentError(`sha256sum expected to be empty for anonymous or https requests`);
    }
    // sha256sum should be valid for non-anonymous http requests.
    if (this.enableSHA256 && sha256sum.length !== 64) {
      throw new errors.InvalidArgumentError(`Invalid sha256sum : ${sha256sum}`);
    }
    await this.checkAndRefreshCreds();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    region = region || (await this.getBucketRegionAsync(options.bucketName));
    const reqOptions = this.getRequestOptions({
      ...options,
      region
    });
    if (!this.anonymous) {
      // For non-anonymous https requests sha256sum is 'UNSIGNED-PAYLOAD' for signature calculation.
      if (!this.enableSHA256) {
        sha256sum = 'UNSIGNED-PAYLOAD';
      }
      const date = new Date();
      reqOptions.headers['x-amz-date'] = (0, _helper.makeDateLong)(date);
      reqOptions.headers['x-amz-content-sha256'] = sha256sum;
      if (this.sessionToken) {
        reqOptions.headers['x-amz-security-token'] = this.sessionToken;
      }
      reqOptions.headers.authorization = (0, _signing.signV4)(reqOptions, this.accessKey, this.secretKey, region, date, sha256sum);
    }
    const response = await (0, _request.request)(this.transport, reqOptions, body);
    if (!response.statusCode) {
      throw new Error("BUG: response doesn't have a statusCode");
    }
    if (!statusCodes.includes(response.statusCode)) {
      // For an incorrect region, S3 server always sends back 400.
      // But we will do cache invalidation for all errors so that,
      // in future, if AWS S3 decides to send a different status code or
      // XML error code we will still work fine.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      delete this.regionMap[options.bucketName];
      const err = await xmlParsers.parseResponseError(response);
      this.logHTTP(reqOptions, response, err);
      throw err;
    }
    this.logHTTP(reqOptions, response);
    return response;
  }

  /**
   * gets the region of the bucket
   *
   * @param bucketName
   *
   * @internal
   */
  async getBucketRegionAsync(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name : ${bucketName}`);
    }

    // Region is set with constructor, return the region right here.
    if (this.region) {
      return this.region;
    }
    const cached = this.regionMap[bucketName];
    if (cached) {
      return cached;
    }
    const extractRegionAsync = async response => {
      const body = await (0, _response.readAsString)(response);
      const region = xmlParsers.parseBucketRegion(body) || _helpers.DEFAULT_REGION;
      this.regionMap[bucketName] = region;
      return region;
    };
    const method = 'GET';
    const query = 'location';
    // `getBucketLocation` behaves differently in following ways for
    // different environments.
    //
    // - For nodejs env we default to path style requests.
    // - For browser env path style requests on buckets yields CORS
    //   error. To circumvent this problem we make a virtual host
    //   style request signed with 'us-east-1'. This request fails
    //   with an error 'AuthorizationHeaderMalformed', additionally
    //   the error XML also provides Region of the bucket. To validate
    //   this region is proper we retry the same request with the newly
    //   obtained region.
    const pathStyle = this.pathStyle && !_browserOrNode.isBrowser;
    let region;
    try {
      const res = await this.makeRequestAsync({
        method,
        bucketName,
        query,
        pathStyle
      }, '', [200], _helpers.DEFAULT_REGION);
      return extractRegionAsync(res);
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (!(e.name === 'AuthorizationHeaderMalformed')) {
        throw e;
      }
      // @ts-expect-error we set extra properties on error object
      region = e.Region;
      if (!region) {
        throw e;
      }
    }
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query,
      pathStyle
    }, '', [200], region);
    return await extractRegionAsync(res);
  }

  /**
   * makeRequest is the primitive used by the apis for making S3 requests.
   * payload can be empty string in case of no payload.
   * statusCode is the expected statusCode. If response.statusCode does not match
   * we parse the XML error and call the callback with the error message.
   * A valid region is passed by the calls - listBuckets, makeBucket and
   * getBucketRegion.
   *
   * @deprecated use `makeRequestAsync` instead
   */
  makeRequest(options, payload = '', expectedCodes = [200], region = '', returnResponse, cb) {
    let prom;
    if (returnResponse) {
      prom = this.makeRequestAsync(options, payload, expectedCodes, region);
    } else {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error compatible for old behaviour
      prom = this.makeRequestAsyncOmit(options, payload, expectedCodes, region);
    }
    prom.then(result => cb(null, result), err => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      cb(err);
    });
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @deprecated use `makeRequestStreamAsync` instead
   */
  makeRequestStream(options, stream, sha256sum, statusCodes, region, returnResponse, cb) {
    const executor = async () => {
      const res = await this.makeRequestStreamAsync(options, stream, sha256sum, statusCodes, region);
      if (!returnResponse) {
        await (0, _response.drainResponse)(res);
      }
      return res;
    };
    executor().then(result => cb(null, result),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    err => cb(err));
  }

  /**
   * @deprecated use `getBucketRegionAsync` instead
   */
  getBucketRegion(bucketName, cb) {
    return this.getBucketRegionAsync(bucketName).then(result => cb(null, result),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    err => cb(err));
  }

  // Bucket operations

  /**
   * Creates the bucket `bucketName`.
   *
   */
  async makeBucket(bucketName, region = '', makeOpts = {}) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    // Backward Compatibility
    if ((0, _helper.isObject)(region)) {
      makeOpts = region;
      region = '';
    }
    if (!(0, _helper.isString)(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!(0, _helper.isObject)(makeOpts)) {
      throw new TypeError('makeOpts should be of type "object"');
    }
    let payload = '';

    // Region already set in constructor, validate if
    // caller requested bucket location is same.
    if (region && this.region) {
      if (region !== this.region) {
        throw new errors.InvalidArgumentError(`Configured region ${this.region}, requested ${region}`);
      }
    }
    // sending makeBucket request with XML containing 'us-east-1' fails. For
    // default region server expects the request without body
    if (region && region !== _helpers.DEFAULT_REGION) {
      payload = xml.buildObject({
        CreateBucketConfiguration: {
          $: {
            xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/'
          },
          LocationConstraint: region
        }
      });
    }
    const method = 'PUT';
    const headers = {};
    if (makeOpts.ObjectLocking) {
      headers['x-amz-bucket-object-lock-enabled'] = true;
    }

    // For custom region clients  default to custom region specified in client constructor
    const finalRegion = this.region || region || _helpers.DEFAULT_REGION;
    const requestOpt = {
      method,
      bucketName,
      headers
    };
    try {
      await this.makeRequestAsyncOmit(requestOpt, payload, [200], finalRegion);
    } catch (err) {
      if (region === '' || region === _helpers.DEFAULT_REGION) {
        if (err instanceof errors.S3Error) {
          const errCode = err.code;
          const errRegion = err.region;
          if (errCode === 'AuthorizationHeaderMalformed' && errRegion !== '') {
            // Retry with region returned as part of error
            await this.makeRequestAsyncOmit(requestOpt, payload, [200], errCode);
          }
        }
      }
      throw err;
    }
  }

  /**
   * To check if a bucket already exists.
   */
  async bucketExists(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'HEAD';
    try {
      await this.makeRequestAsyncOmit({
        method,
        bucketName
      });
    } catch (err) {
      // @ts-ignore
      if (err.code === 'NoSuchBucket' || err.code === 'NotFound') {
        return false;
      }
      throw err;
    }
    return true;
  }

  /**
   * @deprecated use promise style API
   */

  async removeBucket(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    await this.makeRequestAsyncOmit({
      method,
      bucketName
    }, '', [204]);
    delete this.regionMap[bucketName];
  }

  /**
   * Callback is called with readable stream of the object content.
   */
  async getObject(bucketName, objectName, getOpts = {}) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.getPartialObject(bucketName, objectName, 0, 0, getOpts);
  }

  /**
   * Callback is called with readable stream of the partial object content.
   * @param bucketName
   * @param objectName
   * @param offset
   * @param length - length of the object that will be read in the stream (optional, if not specified we read the rest of the file from the offset)
   * @param getOpts
   */
  async getPartialObject(bucketName, objectName, offset, length = 0, getOpts = {}) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isNumber)(offset)) {
      throw new TypeError('offset should be of type "number"');
    }
    if (!(0, _helper.isNumber)(length)) {
      throw new TypeError('length should be of type "number"');
    }
    let range = '';
    if (offset || length) {
      if (offset) {
        range = `bytes=${+offset}-`;
      } else {
        range = 'bytes=0-';
        offset = 0;
      }
      if (length) {
        range += `${+length + offset - 1}`;
      }
    }
    const sseHeaders = {
      ...(getOpts.SSECustomerAlgorithm && {
        'X-Amz-Server-Side-Encryption-Customer-Algorithm': getOpts.SSECustomerAlgorithm
      }),
      ...(getOpts.SSECustomerKey && {
        'X-Amz-Server-Side-Encryption-Customer-Key': getOpts.SSECustomerKey
      }),
      ...(getOpts.SSECustomerKeyMD5 && {
        'X-Amz-Server-Side-Encryption-Customer-Key-MD5': getOpts.SSECustomerKeyMD5
      })
    };
    const headers = {
      ...(0, _helper.prependXAMZMeta)(sseHeaders),
      ...(range !== '' && {
        range
      })
    };
    const expectedStatusCodes = [200];
    if (range) {
      expectedStatusCodes.push(206);
    }
    const method = 'GET';
    const query = qs.stringify(getOpts);
    return await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      headers,
      query
    }, '', expectedStatusCodes);
  }

  /**
   * download object content to a file.
   * This method will create a temp file named `${filename}.${etag}.part.minio` when downloading.
   *
   * @param bucketName - name of the bucket
   * @param objectName - name of the object
   * @param filePath - path to which the object data will be written to
   * @param getOpts - Optional object get option
   */
  async fGetObject(bucketName, objectName, filePath, getOpts = {}) {
    // Input validation.
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    const downloadToTmpFile = async () => {
      let partFileStream;
      const objStat = await this.statObject(bucketName, objectName, getOpts);
      const partFile = `${filePath}.${objStat.etag}.part.minio`;
      await _async2.fsp.mkdir(path.dirname(filePath), {
        recursive: true
      });
      let offset = 0;
      try {
        const stats = await _async2.fsp.stat(partFile);
        if (objStat.size === stats.size) {
          return partFile;
        }
        offset = stats.size;
        partFileStream = fs.createWriteStream(partFile, {
          flags: 'a'
        });
      } catch (e) {
        if (e instanceof Error && e.code === 'ENOENT') {
          // file not exist
          partFileStream = fs.createWriteStream(partFile, {
            flags: 'w'
          });
        } else {
          // other error, maybe access deny
          throw e;
        }
      }
      const downloadStream = await this.getPartialObject(bucketName, objectName, offset, 0, getOpts);
      await _async2.streamPromise.pipeline(downloadStream, partFileStream);
      const stats = await _async2.fsp.stat(partFile);
      if (stats.size === objStat.size) {
        return partFile;
      }
      throw new Error('Size mismatch between downloaded file and the object');
    };
    const partFile = await downloadToTmpFile();
    await _async2.fsp.rename(partFile, filePath);
  }

  /**
   * Stat information of the object.
   */
  async statObject(bucketName, objectName, statOpts = {}) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(statOpts)) {
      throw new errors.InvalidArgumentError('statOpts should be of type "object"');
    }
    const query = qs.stringify(statOpts);
    const method = 'HEAD';
    const res = await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query
    });
    return {
      size: parseInt(res.headers['content-length']),
      metaData: (0, _helper.extractMetadata)(res.headers),
      lastModified: new Date(res.headers['last-modified']),
      versionId: (0, _helper.getVersionId)(res.headers),
      etag: (0, _helper.sanitizeETag)(res.headers.etag)
    };
  }
  async removeObject(bucketName, objectName, removeOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (removeOpts && !(0, _helper.isObject)(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    const method = 'DELETE';
    const headers = {};
    if (removeOpts !== null && removeOpts !== void 0 && removeOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    if (removeOpts !== null && removeOpts !== void 0 && removeOpts.forceDelete) {
      headers['x-minio-force-delete'] = true;
    }
    const queryParams = {};
    if (removeOpts !== null && removeOpts !== void 0 && removeOpts.versionId) {
      queryParams.versionId = `${removeOpts.versionId}`;
    }
    const query = qs.stringify(queryParams);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      headers,
      query
    }, '', [200, 204]);
  }

  // Calls implemented below are related to multipart.

  listIncompleteUploads(bucket, prefix, recursive) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!(0, _helper.isValidBucketName)(bucket)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucket);
    }
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!(0, _helper.isBoolean)(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    const delimiter = recursive ? '' : '/';
    let keyMarker = '';
    let uploadIdMarker = '';
    const uploads = [];
    let ended = false;

    // TODO: refactor this with async/await and `stream.Readable.from`
    const readStream = new stream.Readable({
      objectMode: true
    });
    readStream._read = () => {
      // push one upload info per _read()
      if (uploads.length) {
        return readStream.push(uploads.shift());
      }
      if (ended) {
        return readStream.push(null);
      }
      this.listIncompleteUploadsQuery(bucket, prefix, keyMarker, uploadIdMarker, delimiter).then(result => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        result.prefixes.forEach(prefix => uploads.push(prefix));
        async.eachSeries(result.uploads, (upload, cb) => {
          // for each incomplete upload add the sizes of its uploaded parts
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          this.listParts(bucket, upload.key, upload.uploadId).then(parts => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            upload.size = parts.reduce((acc, item) => acc + item.size, 0);
            uploads.push(upload);
            cb();
          }, err => cb(err));
        }, err => {
          if (err) {
            readStream.emit('error', err);
            return;
          }
          if (result.isTruncated) {
            keyMarker = result.nextKeyMarker;
            uploadIdMarker = result.nextUploadIdMarker;
          } else {
            ended = true;
          }

          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          readStream._read();
        });
      }, e => {
        readStream.emit('error', e);
      });
    };
    return readStream;
  }

  /**
   * Called by listIncompleteUploads to fetch a batch of incomplete uploads.
   */
  async listIncompleteUploadsQuery(bucketName, prefix, keyMarker, uploadIdMarker, delimiter) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isString)(keyMarker)) {
      throw new TypeError('keyMarker should be of type "string"');
    }
    if (!(0, _helper.isString)(uploadIdMarker)) {
      throw new TypeError('uploadIdMarker should be of type "string"');
    }
    if (!(0, _helper.isString)(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    const queries = [];
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(delimiter)}`);
    if (keyMarker) {
      queries.push(`key-marker=${(0, _helper.uriEscape)(keyMarker)}`);
    }
    if (uploadIdMarker) {
      queries.push(`upload-id-marker=${uploadIdMarker}`);
    }
    const maxUploads = 1000;
    queries.push(`max-uploads=${maxUploads}`);
    queries.sort();
    queries.unshift('uploads');
    let query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseListMultipart(body);
  }

  /**
   * Initiate a new multipart upload.
   * @internal
   */
  async initiateNewMultipartUpload(bucketName, objectName, headers) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(headers)) {
      throw new errors.InvalidObjectNameError('contentType should be of type "object"');
    }
    const method = 'POST';
    const query = 'uploads';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query,
      headers
    });
    const body = await (0, _response.readAsBuffer)(res);
    return (0, xmlParsers.parseInitiateMultipart)(body.toString());
  }

  /**
   * Internal Method to abort a multipart upload request in case of any errors.
   *
   * @param bucketName - Bucket Name
   * @param objectName - Object Name
   * @param uploadId - id of a multipart upload to cancel during compose object sequence.
   */
  async abortMultipartUpload(bucketName, objectName, uploadId) {
    const method = 'DELETE';
    const query = `uploadId=${uploadId}`;
    const requestOptions = {
      method,
      bucketName,
      objectName: objectName,
      query
    };
    await this.makeRequestAsyncOmit(requestOptions, '', [204]);
  }
  async findUploadId(bucketName, objectName) {
    var _latestUpload;
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    let latestUpload;
    let keyMarker = '';
    let uploadIdMarker = '';
    for (;;) {
      const result = await this.listIncompleteUploadsQuery(bucketName, objectName, keyMarker, uploadIdMarker, '');
      for (const upload of result.uploads) {
        if (upload.key === objectName) {
          if (!latestUpload || upload.initiated.getTime() > latestUpload.initiated.getTime()) {
            latestUpload = upload;
          }
        }
      }
      if (result.isTruncated) {
        keyMarker = result.nextKeyMarker;
        uploadIdMarker = result.nextUploadIdMarker;
        continue;
      }
      break;
    }
    return (_latestUpload = latestUpload) === null || _latestUpload === void 0 ? void 0 : _latestUpload.uploadId;
  }

  /**
   * this call will aggregate the parts on the server into a single object.
   */
  async completeMultipartUpload(bucketName, objectName, uploadId, etags) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!(0, _helper.isObject)(etags)) {
      throw new TypeError('etags should be of type "Array"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const method = 'POST';
    const query = `uploadId=${(0, _helper.uriEscape)(uploadId)}`;
    const builder = new _xml2js.Builder();
    const payload = builder.buildObject({
      CompleteMultipartUpload: {
        $: {
          xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/'
        },
        Part: etags.map(etag => {
          return {
            PartNumber: etag.part,
            ETag: etag.etag
          };
        })
      }
    });
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, payload);
    const body = await (0, _response.readAsBuffer)(res);
    const result = (0, xmlParsers.parseCompleteMultipart)(body.toString());
    if (!result) {
      throw new Error('BUG: failed to parse server response');
    }
    if (result.errCode) {
      // Multipart Complete API returns an error XML after a 200 http status
      throw new errors.S3Error(result.errMessage);
    }
    return {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      etag: result.etag,
      versionId: (0, _helper.getVersionId)(res.headers)
    };
  }

  /**
   * Get part-info of all parts of an incomplete upload specified by uploadId.
   */
  async listParts(bucketName, objectName, uploadId) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const parts = [];
    let marker = 0;
    let result;
    do {
      result = await this.listPartsQuery(bucketName, objectName, uploadId, marker);
      marker = result.marker;
      parts.push(...result.parts);
    } while (result.isTruncated);
    return parts;
  }

  /**
   * Called by listParts to fetch a batch of part-info
   */
  async listPartsQuery(bucketName, objectName, uploadId, marker) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!(0, _helper.isNumber)(marker)) {
      throw new TypeError('marker should be of type "number"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    let query = `uploadId=${(0, _helper.uriEscape)(uploadId)}`;
    if (marker) {
      query += `&part-number-marker=${marker}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    });
    return xmlParsers.parseListParts(await (0, _response.readAsString)(res));
  }
  async listBuckets() {
    const method = 'GET';
    const regionConf = this.region || _helpers.DEFAULT_REGION;
    const httpRes = await this.makeRequestAsync({
      method
    }, '', [200], regionConf);
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseListBucket(xmlResult);
  }

  /**
   * Calculate part size given the object size. Part size will be atleast this.partSize
   */
  calculatePartSize(size) {
    if (!(0, _helper.isNumber)(size)) {
      throw new TypeError('size should be of type "number"');
    }
    if (size > this.maxObjectSize) {
      throw new TypeError(`size should not be more than ${this.maxObjectSize}`);
    }
    if (this.overRidePartSize) {
      return this.partSize;
    }
    let partSize = this.partSize;
    for (;;) {
      // while(true) {...} throws linting error.
      // If partSize is big enough to accomodate the object size, then use it.
      if (partSize * 10000 > size) {
        return partSize;
      }
      // Try part sizes as 64MB, 80MB, 96MB etc.
      partSize += 16 * 1024 * 1024;
    }
  }

  /**
   * Uploads the object using contents from a file
   */
  async fPutObject(bucketName, objectName, filePath, metaData = {}) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    if (!(0, _helper.isObject)(metaData)) {
      throw new TypeError('metaData should be of type "object"');
    }

    // Inserts correct `content-type` attribute based on metaData and filePath
    metaData = (0, _helper.insertContentType)(metaData, filePath);
    const stat = await _async2.fsp.lstat(filePath);
    await this.putObject(bucketName, objectName, fs.createReadStream(filePath), stat.size, metaData);
  }

  /**
   *  Uploading a stream, "Buffer" or "string".
   *  It's recommended to pass `size` argument with stream.
   */
  async putObject(bucketName, objectName, stream, size, metaData) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }

    // We'll need to shift arguments to the left because of metaData
    // and size being optional.
    if ((0, _helper.isObject)(size)) {
      metaData = size;
    }
    // Ensures Metadata has appropriate prefix for A3 API
    const headers = (0, _helper.prependXAMZMeta)(metaData);
    if (typeof stream === 'string' || stream instanceof Buffer) {
      // Adapts the non-stream interface into a stream.
      size = stream.length;
      stream = (0, _helper.readableStream)(stream);
    } else if (!(0, _helper.isReadableStream)(stream)) {
      throw new TypeError('third argument should be of type "stream.Readable" or "Buffer" or "string"');
    }
    if ((0, _helper.isNumber)(size) && size < 0) {
      throw new errors.InvalidArgumentError(`size cannot be negative, given size: ${size}`);
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (!(0, _helper.isNumber)(size)) {
      size = this.maxObjectSize;
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (size === undefined) {
      const statSize = await (0, _helper.getContentLength)(stream);
      if (statSize !== null) {
        size = statSize;
      }
    }
    if (!(0, _helper.isNumber)(size)) {
      // Backward compatibility
      size = this.maxObjectSize;
    }
    const partSize = this.calculatePartSize(size);
    if (typeof stream === 'string' || Buffer.isBuffer(stream) || size <= partSize) {
      const buf = (0, _helper.isReadableStream)(stream) ? await (0, _response.readAsBuffer)(stream) : Buffer.from(stream);
      return this.uploadBuffer(bucketName, objectName, headers, buf);
    }
    return this.uploadStream(bucketName, objectName, headers, stream, partSize);
  }

  /**
   * method to upload buffer in one call
   * @private
   */
  async uploadBuffer(bucketName, objectName, headers, buf) {
    const {
      md5sum,
      sha256sum
    } = (0, _helper.hashBinary)(buf, this.enableSHA256);
    headers['Content-Length'] = buf.length;
    if (!this.enableSHA256) {
      headers['Content-MD5'] = md5sum;
    }
    const res = await this.makeRequestStreamAsync({
      method: 'PUT',
      bucketName,
      objectName,
      headers
    }, buf, sha256sum, [200], '');
    await (0, _response.drainResponse)(res);
    return {
      etag: (0, _helper.sanitizeETag)(res.headers.etag),
      versionId: (0, _helper.getVersionId)(res.headers)
    };
  }

  /**
   * upload stream with MultipartUpload
   * @private
   */
  async uploadStream(bucketName, objectName, headers, body, partSize) {
    // A map of the previously uploaded chunks, for resuming a file upload. This
    // will be null if we aren't resuming an upload.
    const oldParts = {};

    // Keep track of the etags for aggregating the chunks together later. Each
    // etag represents a single chunk of the file.
    const eTags = [];
    const previousUploadId = await this.findUploadId(bucketName, objectName);
    let uploadId;
    if (!previousUploadId) {
      uploadId = await this.initiateNewMultipartUpload(bucketName, objectName, headers);
    } else {
      uploadId = previousUploadId;
      const oldTags = await this.listParts(bucketName, objectName, previousUploadId);
      oldTags.forEach(e => {
        oldTags[e.part] = e;
      });
    }
    const chunkier = new _blockStream({
      size: partSize,
      zeroPadding: false
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, o] = await Promise.all([new Promise((resolve, reject) => {
      body.pipe(chunkier).on('error', reject);
      chunkier.on('end', resolve).on('error', reject);
    }), (async () => {
      let partNumber = 1;
      for await (const chunk of chunkier) {
        const md5 = crypto.createHash('md5').update(chunk).digest();
        const oldPart = oldParts[partNumber];
        if (oldPart) {
          if (oldPart.etag === md5.toString('hex')) {
            eTags.push({
              part: partNumber,
              etag: oldPart.etag
            });
            partNumber++;
            continue;
          }
        }
        partNumber++;

        // now start to upload missing part
        const options = {
          method: 'PUT',
          query: qs.stringify({
            partNumber,
            uploadId
          }),
          headers: {
            'Content-Length': chunk.length,
            'Content-MD5': md5.toString('base64'),
            ...headers
          },
          bucketName,
          objectName
        };
        const response = await this.makeRequestAsyncOmit(options, chunk);
        let etag = response.headers.etag;
        if (etag) {
          etag = etag.replace(/^"/, '').replace(/"$/, '');
        } else {
          etag = '';
        }
        eTags.push({
          part: partNumber,
          etag
        });
      }
      return await this.completeMultipartUpload(bucketName, objectName, uploadId, eTags);
    })()]);
    return o;
  }
  async removeBucketReplication(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'replication';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [200, 204], '');
  }
  async setBucketReplication(bucketName, replicationConfig) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(replicationConfig)) {
      throw new errors.InvalidArgumentError('replicationConfig should be of type "object"');
    } else {
      if (_lodash.isEmpty(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Role cannot be empty');
      } else if (replicationConfig.role && !(0, _helper.isString)(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Invalid value for role', replicationConfig.role);
      }
      if (_lodash.isEmpty(replicationConfig.rules)) {
        throw new errors.InvalidArgumentError('Minimum one replication rule must be specified');
      }
    }
    const method = 'PUT';
    const query = 'replication';
    const headers = {};
    const replicationParamsConfig = {
      ReplicationConfiguration: {
        Role: replicationConfig.role,
        Rule: replicationConfig.rules
      }
    };
    const builder = new _xml2js.Builder({
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(replicationParamsConfig);
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketReplication(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'replication';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    }, '', [200, 204]);
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseReplicationConfig(xmlResult);
  }
  async getObjectLegalHold(bucketName, objectName, getOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts) {
      if (!(0, _helper.isObject)(getOpts)) {
        throw new TypeError('getOpts should be of type "Object"');
      } else if (Object.keys(getOpts).length > 0 && getOpts.versionId && !(0, _helper.isString)(getOpts.versionId)) {
        throw new TypeError('versionId should be of type string.:', getOpts.versionId);
      }
    }
    const method = 'GET';
    let query = 'legal-hold';
    if (getOpts !== null && getOpts !== void 0 && getOpts.versionId) {
      query += `&versionId=${getOpts.versionId}`;
    }
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, '', [200]);
    const strRes = await (0, _response.readAsString)(httpRes);
    return (0, xmlParsers.parseObjectLegalHoldConfig)(strRes);
  }
  async setObjectLegalHold(bucketName, objectName, setOpts = {
    status: _helpers.LEGAL_HOLD_STATUS.ENABLED
  }) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(setOpts)) {
      throw new TypeError('setOpts should be of type "Object"');
    } else {
      if (![_helpers.LEGAL_HOLD_STATUS.ENABLED, _helpers.LEGAL_HOLD_STATUS.DISABLED].includes(setOpts === null || setOpts === void 0 ? void 0 : setOpts.status)) {
        throw new TypeError('Invalid status: ' + setOpts.status);
      }
      if (setOpts.versionId && !setOpts.versionId.length) {
        throw new TypeError('versionId should be of type string.:' + setOpts.versionId);
      }
    }
    const method = 'PUT';
    let query = 'legal-hold';
    if (setOpts.versionId) {
      query += `&versionId=${setOpts.versionId}`;
    }
    const config = {
      Status: setOpts.status
    };
    const builder = new _xml2js.Builder({
      rootName: 'LegalHold',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload);
  }

  /**
   * Get Tags associated with a Bucket
   */
  async getBucketTagging(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'tagging';
    const requestOptions = {
      method,
      bucketName,
      query
    };
    const response = await this.makeRequestAsync(requestOptions);
    const body = await (0, _response.readAsString)(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Get the tags associated with a bucket OR an object
   */
  async getObjectTagging(bucketName, objectName, getOpts = {}) {
    const method = 'GET';
    let query = 'tagging';
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (!(0, _helper.isObject)(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    }
    if (getOpts && getOpts.versionId) {
      query = `${query}&versionId=${getOpts.versionId}`;
    }
    const requestOptions = {
      method,
      bucketName,
      query
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    const response = await this.makeRequestAsync(requestOptions);
    const body = await (0, _response.readAsString)(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Set the policy on a bucket or an object prefix.
   */
  async setBucketPolicy(bucketName, policy) {
    // Validate arguments.
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isString)(policy)) {
      throw new errors.InvalidBucketPolicyError(`Invalid bucket policy: ${policy} - must be "string"`);
    }
    const query = 'policy';
    let method = 'DELETE';
    if (policy) {
      method = 'PUT';
    }
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, policy, [204], '');
  }

  /**
   * Get the policy on a bucket or an object prefix.
   */
  async getBucketPolicy(bucketName) {
    // Validate arguments.
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'policy';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    return await (0, _response.readAsString)(res);
  }
  async putObjectRetention(bucketName, objectName, retentionOpts = {}) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(retentionOpts)) {
      throw new errors.InvalidArgumentError('retentionOpts should be of type "object"');
    } else {
      if (retentionOpts.governanceBypass && !(0, _helper.isBoolean)(retentionOpts.governanceBypass)) {
        throw new errors.InvalidArgumentError(`Invalid value for governanceBypass: ${retentionOpts.governanceBypass}`);
      }
      if (retentionOpts.mode && ![_helpers.RETENTION_MODES.COMPLIANCE, _helpers.RETENTION_MODES.GOVERNANCE].includes(retentionOpts.mode)) {
        throw new errors.InvalidArgumentError(`Invalid object retention mode: ${retentionOpts.mode}`);
      }
      if (retentionOpts.retainUntilDate && !(0, _helper.isString)(retentionOpts.retainUntilDate)) {
        throw new errors.InvalidArgumentError(`Invalid value for retainUntilDate: ${retentionOpts.retainUntilDate}`);
      }
      if (retentionOpts.versionId && !(0, _helper.isString)(retentionOpts.versionId)) {
        throw new errors.InvalidArgumentError(`Invalid value for versionId: ${retentionOpts.versionId}`);
      }
    }
    const method = 'PUT';
    let query = 'retention';
    const headers = {};
    if (retentionOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    const builder = new _xml2js.Builder({
      rootName: 'Retention',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const params = {};
    if (retentionOpts.mode) {
      params.Mode = retentionOpts.mode;
    }
    if (retentionOpts.retainUntilDate) {
      params.RetainUntilDate = retentionOpts.retainUntilDate;
    }
    if (retentionOpts.versionId) {
      query += `&versionId=${retentionOpts.versionId}`;
    }
    const payload = builder.buildObject(params);
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload, [200, 204]);
  }
  async getObjectLockConfig(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'object-lock';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseObjectLockConfig(xmlResult);
  }
  async setObjectLockConfig(bucketName, lockConfigOpts) {
    const retentionModes = [_helpers.RETENTION_MODES.COMPLIANCE, _helpers.RETENTION_MODES.GOVERNANCE];
    const validUnits = [_helpers.RETENTION_VALIDITY_UNITS.DAYS, _helpers.RETENTION_VALIDITY_UNITS.YEARS];
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (lockConfigOpts.mode && !retentionModes.includes(lockConfigOpts.mode)) {
      throw new TypeError(`lockConfigOpts.mode should be one of ${retentionModes}`);
    }
    if (lockConfigOpts.unit && !validUnits.includes(lockConfigOpts.unit)) {
      throw new TypeError(`lockConfigOpts.unit should be one of ${validUnits}`);
    }
    if (lockConfigOpts.validity && !(0, _helper.isNumber)(lockConfigOpts.validity)) {
      throw new TypeError(`lockConfigOpts.validity should be a number`);
    }
    const method = 'PUT';
    const query = 'object-lock';
    const config = {
      ObjectLockEnabled: 'Enabled'
    };
    const configKeys = Object.keys(lockConfigOpts);
    const isAllKeysSet = ['unit', 'mode', 'validity'].every(lck => configKeys.includes(lck));
    // Check if keys are present and all keys are present.
    if (configKeys.length > 0) {
      if (!isAllKeysSet) {
        throw new TypeError(`lockConfigOpts.mode,lockConfigOpts.unit,lockConfigOpts.validity all the properties should be specified.`);
      } else {
        config.Rule = {
          DefaultRetention: {}
        };
        if (lockConfigOpts.mode) {
          config.Rule.DefaultRetention.Mode = lockConfigOpts.mode;
        }
        if (lockConfigOpts.unit === _helpers.RETENTION_VALIDITY_UNITS.DAYS) {
          config.Rule.DefaultRetention.Days = lockConfigOpts.validity;
        } else if (lockConfigOpts.unit === _helpers.RETENTION_VALIDITY_UNITS.YEARS) {
          config.Rule.DefaultRetention.Years = lockConfigOpts.validity;
        }
      }
    }
    const builder = new _xml2js.Builder({
      rootName: 'ObjectLockConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketVersioning(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'versioning';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return await xmlParsers.parseBucketVersioningConfig(xmlResult);
  }
  async setBucketVersioning(bucketName, versionConfig) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Object.keys(versionConfig).length) {
      throw new errors.InvalidArgumentError('versionConfig should be of type "object"');
    }
    const method = 'PUT';
    const query = 'versioning';
    const builder = new _xml2js.Builder({
      rootName: 'VersioningConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(versionConfig);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, payload);
  }
  async setTagging(taggingParams) {
    const {
      bucketName,
      objectName,
      tags,
      putOpts
    } = taggingParams;
    const method = 'PUT';
    let query = 'tagging';
    if (putOpts && putOpts !== null && putOpts !== void 0 && putOpts.versionId) {
      query = `${query}&versionId=${putOpts.versionId}`;
    }
    const tagsList = [];
    for (const [key, value] of Object.entries(tags)) {
      tagsList.push({
        Key: key,
        Value: value
      });
    }
    const taggingConfig = {
      Tagging: {
        TagSet: {
          Tag: tagsList
        }
      }
    };
    const headers = {};
    const builder = new _xml2js.Builder({
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    const payloadBuf = Buffer.from(builder.buildObject(taggingConfig));
    const requestOptions = {
      method,
      bucketName,
      query,
      headers,
      ...(objectName && {
        objectName: objectName
      })
    };
    headers['Content-MD5'] = (0, _helper.toMd5)(payloadBuf);
    await this.makeRequestAsyncOmit(requestOptions, payloadBuf);
  }
  async removeTagging({
    bucketName,
    objectName,
    removeOpts
  }) {
    const method = 'DELETE';
    let query = 'tagging';
    if (removeOpts && Object.keys(removeOpts).length && removeOpts.versionId) {
      query = `${query}&versionId=${removeOpts.versionId}`;
    }
    const requestOptions = {
      method,
      bucketName,
      objectName,
      query
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    await this.makeRequestAsync(requestOptions, '', [200, 204]);
  }
  async setBucketTagging(bucketName, tags) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('maximum tags allowed is 10"');
    }
    await this.setTagging({
      bucketName,
      tags
    });
  }
  async removeBucketTagging(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    await this.removeTagging({
      bucketName
    });
  }
  async setObjectTagging(bucketName, objectName, tags, putOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (!(0, _helper.isObject)(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('Maximum tags allowed is 10"');
    }
    await this.setTagging({
      bucketName,
      objectName,
      tags,
      putOpts
    });
  }
  async removeObjectTagging(bucketName, objectName, removeOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (removeOpts && Object.keys(removeOpts).length && !(0, _helper.isObject)(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    await this.removeTagging({
      bucketName,
      objectName,
      removeOpts
    });
  }
  async selectObjectContent(bucketName, objectName, selectOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!_lodash.isEmpty(selectOpts)) {
      if (!(0, _helper.isString)(selectOpts.expression)) {
        throw new TypeError('sqlExpression should be of type "string"');
      }
      if (!_lodash.isEmpty(selectOpts.inputSerialization)) {
        if (!(0, _helper.isObject)(selectOpts.inputSerialization)) {
          throw new TypeError('inputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('inputSerialization is required');
      }
      if (!_lodash.isEmpty(selectOpts.outputSerialization)) {
        if (!(0, _helper.isObject)(selectOpts.outputSerialization)) {
          throw new TypeError('outputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('outputSerialization is required');
      }
    } else {
      throw new TypeError('valid select configuration is required');
    }
    const method = 'POST';
    const query = `select&select-type=2`;
    const config = [{
      Expression: selectOpts.expression
    }, {
      ExpressionType: selectOpts.expressionType || 'SQL'
    }, {
      InputSerialization: [selectOpts.inputSerialization]
    }, {
      OutputSerialization: [selectOpts.outputSerialization]
    }];

    // Optional
    if (selectOpts.requestProgress) {
      config.push({
        RequestProgress: selectOpts === null || selectOpts === void 0 ? void 0 : selectOpts.requestProgress
      });
    }
    // Optional
    if (selectOpts.scanRange) {
      config.push({
        ScanRange: selectOpts.scanRange
      });
    }
    const builder = new _xml2js.Builder({
      rootName: 'SelectObjectContentRequest',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, payload);
    const body = await (0, _response.readAsBuffer)(res);
    return (0, xmlParsers.parseSelectObjectContentResponse)(body);
  }
  async applyBucketLifecycle(bucketName, policyConfig) {
    const method = 'PUT';
    const query = 'lifecycle';
    const headers = {};
    const builder = new _xml2js.Builder({
      rootName: 'LifecycleConfiguration',
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    const payload = builder.buildObject(policyConfig);
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async removeBucketLifecycle(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'lifecycle';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [204]);
  }
  async setBucketLifecycle(bucketName, lifeCycleConfig) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (_lodash.isEmpty(lifeCycleConfig)) {
      await this.removeBucketLifecycle(bucketName);
    } else {
      await this.applyBucketLifecycle(bucketName, lifeCycleConfig);
    }
  }
  async getBucketLifecycle(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'lifecycle';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseLifecycleConfig(body);
  }
  async setBucketEncryption(bucketName, encryptionConfig) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!_lodash.isEmpty(encryptionConfig) && encryptionConfig.Rule.length > 1) {
      throw new errors.InvalidArgumentError('Invalid Rule length. Only one rule is allowed.: ' + encryptionConfig.Rule);
    }
    let encryptionObj = encryptionConfig;
    if (_lodash.isEmpty(encryptionConfig)) {
      encryptionObj = {
        // Default MinIO Server Supported Rule
        Rule: [{
          ApplyServerSideEncryptionByDefault: {
            SSEAlgorithm: 'AES256'
          }
        }]
      };
    }
    const method = 'PUT';
    const query = 'encryption';
    const builder = new _xml2js.Builder({
      rootName: 'ServerSideEncryptionConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(encryptionObj);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketEncryption(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'encryption';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseBucketEncryptionConfig(body);
  }
  async removeBucketEncryption(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'encryption';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [204]);
  }
  async getObjectRetention(bucketName, objectName, getOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts && !(0, _helper.isObject)(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    } else if (getOpts !== null && getOpts !== void 0 && getOpts.versionId && !(0, _helper.isString)(getOpts.versionId)) {
      throw new errors.InvalidArgumentError('versionId should be of type "string"');
    }
    const method = 'GET';
    let query = 'retention';
    if (getOpts !== null && getOpts !== void 0 && getOpts.versionId) {
      query += `&versionId=${getOpts.versionId}`;
    }
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseObjectRetentionConfig(body);
  }
  async removeObjects(bucketName, objectsList) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Array.isArray(objectsList)) {
      throw new errors.InvalidArgumentError('objectsList should be a list');
    }
    const runDeleteObjects = async batch => {
      const delObjects = batch.map(value => {
        return (0, _helper.isObject)(value) ? {
          Key: value.name,
          VersionId: value.versionId
        } : {
          Key: value
        };
      });
      const remObjects = {
        Delete: {
          Quiet: true,
          Object: delObjects
        }
      };
      const payload = Buffer.from(new _xml2js.Builder({
        headless: true
      }).buildObject(remObjects));
      const headers = {
        'Content-MD5': (0, _helper.toMd5)(payload)
      };
      const res = await this.makeRequestAsync({
        method: 'POST',
        bucketName,
        query: 'delete',
        headers
      }, payload);
      const body = await (0, _response.readAsString)(res);
      return xmlParsers.removeObjectsParser(body);
    };
    const maxEntries = 1000; // max entries accepted in server for DeleteMultipleObjects API.
    // Client side batching
    const batches = [];
    for (let i = 0; i < objectsList.length; i += maxEntries) {
      batches.push(objectsList.slice(i, i + maxEntries));
    }
    const batchResults = await Promise.all(batches.map(runDeleteObjects));
    return batchResults.flat();
  }
  async removeIncompleteUpload(bucketName, objectName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.IsValidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const removeUploadId = await this.findUploadId(bucketName, objectName);
    const method = 'DELETE';
    const query = `uploadId=${removeUploadId}`;
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query
    }, '', [204]);
  }
  async copyObjectV1(targetBucketName, targetObjectName, sourceBucketNameAndObjectName, conditions) {
    if (typeof conditions == 'function') {
      conditions = null;
    }
    if (!(0, _helper.isValidBucketName)(targetBucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + targetBucketName);
    }
    if (!(0, _helper.isValidObjectName)(targetObjectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${targetObjectName}`);
    }
    if (!(0, _helper.isString)(sourceBucketNameAndObjectName)) {
      throw new TypeError('sourceBucketNameAndObjectName should be of type "string"');
    }
    if (sourceBucketNameAndObjectName === '') {
      throw new errors.InvalidPrefixError(`Empty source prefix`);
    }
    if (conditions != null && !(conditions instanceof _copyConditions.CopyConditions)) {
      throw new TypeError('conditions should be of type "CopyConditions"');
    }
    const headers = {};
    headers['x-amz-copy-source'] = (0, _helper.uriResourceEscape)(sourceBucketNameAndObjectName);
    if (conditions) {
      if (conditions.modified !== '') {
        headers['x-amz-copy-source-if-modified-since'] = conditions.modified;
      }
      if (conditions.unmodified !== '') {
        headers['x-amz-copy-source-if-unmodified-since'] = conditions.unmodified;
      }
      if (conditions.matchETag !== '') {
        headers['x-amz-copy-source-if-match'] = conditions.matchETag;
      }
      if (conditions.matchETagExcept !== '') {
        headers['x-amz-copy-source-if-none-match'] = conditions.matchETagExcept;
      }
    }
    const method = 'PUT';
    const res = await this.makeRequestAsync({
      method,
      bucketName: targetBucketName,
      objectName: targetObjectName,
      headers
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseCopyObject(body);
  }
  async copyObjectV2(sourceConfig, destConfig) {
    if (!(sourceConfig instanceof _helpers.CopySourceOptions)) {
      throw new errors.InvalidArgumentError('sourceConfig should of type CopySourceOptions ');
    }
    if (!(destConfig instanceof _helpers.CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (!destConfig.validate()) {
      return Promise.reject();
    }
    if (!destConfig.validate()) {
      return Promise.reject();
    }
    const headers = Object.assign({}, sourceConfig.getHeaders(), destConfig.getHeaders());
    const bucketName = destConfig.Bucket;
    const objectName = destConfig.Object;
    const method = 'PUT';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      headers
    });
    const body = await (0, _response.readAsString)(res);
    const copyRes = xmlParsers.parseCopyObject(body);
    const resHeaders = res.headers;
    const sizeHeaderValue = resHeaders && resHeaders['content-length'];
    const size = typeof sizeHeaderValue === 'number' ? sizeHeaderValue : undefined;
    return {
      Bucket: destConfig.Bucket,
      Key: destConfig.Object,
      LastModified: copyRes.lastModified,
      MetaData: (0, _helper.extractMetadata)(resHeaders),
      VersionId: (0, _helper.getVersionId)(resHeaders),
      SourceVersionId: (0, _helper.getSourceVersionId)(resHeaders),
      Etag: (0, _helper.sanitizeETag)(resHeaders.etag),
      Size: size
    };
  }
  async copyObject(...allArgs) {
    if (typeof allArgs[0] === 'string') {
      const [targetBucketName, targetObjectName, sourceBucketNameAndObjectName, conditions] = allArgs;
      return await this.copyObjectV1(targetBucketName, targetObjectName, sourceBucketNameAndObjectName, conditions);
    }
    const [source, dest] = allArgs;
    return await this.copyObjectV2(source, dest);
  }
  async uploadPart(partConfig) {
    const {
      bucketName,
      objectName,
      uploadID,
      partNumber,
      headers
    } = partConfig;
    const method = 'PUT';
    const query = `uploadId=${uploadID}&partNumber=${partNumber}`;
    const requestOptions = {
      method,
      bucketName,
      objectName: objectName,
      query,
      headers
    };
    const res = await this.makeRequestAsync(requestOptions);
    const body = await (0, _response.readAsString)(res);
    const partRes = (0, xmlParsers.uploadPartParser)(body);
    return {
      etag: (0, _helper.sanitizeETag)(partRes.ETag),
      key: objectName,
      part: partNumber
    };
  }
  async composeObject(destObjConfig, sourceObjList) {
    const sourceFilesLength = sourceObjList.length;
    if (!Array.isArray(sourceObjList)) {
      throw new errors.InvalidArgumentError('sourceConfig should an array of CopySourceOptions ');
    }
    if (!(destObjConfig instanceof _helpers.CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (sourceFilesLength < 1 || sourceFilesLength > _helper.PART_CONSTRAINTS.MAX_PARTS_COUNT) {
      throw new errors.InvalidArgumentError(`"There must be as least one and up to ${_helper.PART_CONSTRAINTS.MAX_PARTS_COUNT} source objects.`);
    }
    for (let i = 0; i < sourceFilesLength; i++) {
      const sObj = sourceObjList[i];
      if (!sObj.validate()) {
        return false;
      }
    }
    if (!destObjConfig.validate()) {
      return false;
    }
    const getStatOptions = srcConfig => {
      let statOpts = {};
      if (!_lodash.isEmpty(srcConfig.VersionID)) {
        statOpts = {
          versionId: srcConfig.VersionID
        };
      }
      return statOpts;
    };
    const srcObjectSizes = [];
    let totalSize = 0;
    let totalParts = 0;
    const sourceObjStats = sourceObjList.map(srcItem => this.statObject(srcItem.Bucket, srcItem.Object, getStatOptions(srcItem)));
    const srcObjectInfos = await Promise.all(sourceObjStats);
    const validatedStats = srcObjectInfos.map((resItemStat, index) => {
      const srcConfig = sourceObjList[index];
      let srcCopySize = resItemStat.size;
      // Check if a segment is specified, and if so, is the
      // segment within object bounds?
      if (srcConfig && srcConfig.MatchRange) {
        // Since range is specified,
        //    0 <= src.srcStart <= src.srcEnd
        // so only invalid case to check is:
        const srcStart = srcConfig.Start;
        const srcEnd = srcConfig.End;
        if (srcEnd >= srcCopySize || srcStart < 0) {
          throw new errors.InvalidArgumentError(`CopySrcOptions ${index} has invalid segment-to-copy [${srcStart}, ${srcEnd}] (size is ${srcCopySize})`);
        }
        srcCopySize = srcEnd - srcStart + 1;
      }

      // Only the last source may be less than `absMinPartSize`
      if (srcCopySize < _helper.PART_CONSTRAINTS.ABS_MIN_PART_SIZE && index < sourceFilesLength - 1) {
        throw new errors.InvalidArgumentError(`CopySrcOptions ${index} is too small (${srcCopySize}) and it is not the last part.`);
      }

      // Is data to copy too large?
      totalSize += srcCopySize;
      if (totalSize > _helper.PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE) {
        throw new errors.InvalidArgumentError(`Cannot compose an object of size ${totalSize} (> 5TiB)`);
      }

      // record source size
      srcObjectSizes[index] = srcCopySize;

      // calculate parts needed for current source
      totalParts += (0, _helper.partsRequired)(srcCopySize);
      // Do we need more parts than we are allowed?
      if (totalParts > _helper.PART_CONSTRAINTS.MAX_PARTS_COUNT) {
        throw new errors.InvalidArgumentError(`Your proposed compose object requires more than ${_helper.PART_CONSTRAINTS.MAX_PARTS_COUNT} parts`);
      }
      return resItemStat;
    });
    if (totalParts === 1 && totalSize <= _helper.PART_CONSTRAINTS.MAX_PART_SIZE || totalSize === 0) {
      return await this.copyObject(sourceObjList[0], destObjConfig); // use copyObjectV2
    }

    // preserve etag to avoid modification of object while copying.
    for (let i = 0; i < sourceFilesLength; i++) {
      ;
      sourceObjList[i].MatchETag = validatedStats[i].etag;
    }
    const splitPartSizeList = validatedStats.map((resItemStat, idx) => {
      return (0, _helper.calculateEvenSplits)(srcObjectSizes[idx], sourceObjList[idx]);
    });
    const getUploadPartConfigList = uploadId => {
      const uploadPartConfigList = [];
      splitPartSizeList.forEach((splitSize, splitIndex) => {
        if (splitSize) {
          const {
            startIndex: startIdx,
            endIndex: endIdx,
            objInfo: objConfig
          } = splitSize;
          const partIndex = splitIndex + 1; // part index starts from 1.
          const totalUploads = Array.from(startIdx);
          const headers = sourceObjList[splitIndex].getHeaders();
          totalUploads.forEach((splitStart, upldCtrIdx) => {
            const splitEnd = endIdx[upldCtrIdx];
            const sourceObj = `${objConfig.Bucket}/${objConfig.Object}`;
            headers['x-amz-copy-source'] = `${sourceObj}`;
            headers['x-amz-copy-source-range'] = `bytes=${splitStart}-${splitEnd}`;
            const uploadPartConfig = {
              bucketName: destObjConfig.Bucket,
              objectName: destObjConfig.Object,
              uploadID: uploadId,
              partNumber: partIndex,
              headers: headers,
              sourceObj: sourceObj
            };
            uploadPartConfigList.push(uploadPartConfig);
          });
        }
      });
      return uploadPartConfigList;
    };
    const uploadAllParts = async uploadList => {
      const partUploads = uploadList.map(async item => {
        return this.uploadPart(item);
      });
      // Process results here if needed
      return await Promise.all(partUploads);
    };
    const performUploadParts = async uploadId => {
      const uploadList = getUploadPartConfigList(uploadId);
      const partsRes = await uploadAllParts(uploadList);
      return partsRes.map(partCopy => ({
        etag: partCopy.etag,
        part: partCopy.part
      }));
    };
    const newUploadHeaders = destObjConfig.getHeaders();
    const uploadId = await this.initiateNewMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, newUploadHeaders);
    try {
      const partsDone = await performUploadParts(uploadId);
      return await this.completeMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, uploadId, partsDone);
    } catch (err) {
      return await this.abortMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, uploadId);
    }
  }
  async presignedUrl(method, bucketName, objectName, expires, reqParams, requestDate) {
    var _requestDate;
    if (this.anonymous) {
      throw new errors.AnonymousRequestError(`Presigned ${method} url cannot be generated for anonymous requests`);
    }
    if (!expires) {
      expires = _helpers.PRESIGN_EXPIRY_DAYS_MAX;
    }
    if (!reqParams) {
      reqParams = {};
    }
    if (!requestDate) {
      requestDate = new Date();
    }

    // Type assertions
    if (expires && typeof expires !== 'number') {
      throw new TypeError('expires should be of type "number"');
    }
    if (reqParams && typeof reqParams !== 'object') {
      throw new TypeError('reqParams should be of type "object"');
    }
    if (requestDate && !(requestDate instanceof Date) || requestDate && isNaN((_requestDate = requestDate) === null || _requestDate === void 0 ? void 0 : _requestDate.getTime())) {
      throw new TypeError('requestDate should be of type "Date" and valid');
    }
    const query = reqParams ? qs.stringify(reqParams) : undefined;
    try {
      const region = await this.getBucketRegionAsync(bucketName);
      await this.checkAndRefreshCreds();
      const reqOptions = this.getRequestOptions({
        method,
        region,
        bucketName,
        objectName,
        query
      });
      return (0, _signing.presignSignatureV4)(reqOptions, this.accessKey, this.secretKey, this.sessionToken, region, requestDate, expires);
    } catch (err) {
      throw new errors.InvalidArgumentError(`Unable to get bucket region for  ${bucketName}.`);
    }
  }
  async presignedGetObject(bucketName, objectName, expires, respHeaders, requestDate) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const validRespHeaders = ['response-content-type', 'response-content-language', 'response-expires', 'response-cache-control', 'response-content-disposition', 'response-content-encoding'];
    validRespHeaders.forEach(header => {
      // @ts-ignore
      if (respHeaders !== undefined && respHeaders[header] !== undefined && !(0, _helper.isString)(respHeaders[header])) {
        throw new TypeError(`response header ${header} should be of type "string"`);
      }
    });
    return this.presignedUrl('GET', bucketName, objectName, expires, respHeaders, requestDate);
  }
  async presignedPutObject(bucketName, objectName, expires) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.presignedUrl('PUT', bucketName, objectName, expires);
  }
  newPostPolicy() {
    return new _postPolicy.PostPolicy();
  }
  async presignedPostPolicy(postPolicy) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned POST policy cannot be generated for anonymous requests');
    }
    if (!(0, _helper.isObject)(postPolicy)) {
      throw new TypeError('postPolicy should be of type "object"');
    }
    const bucketName = postPolicy.formData.bucket;
    try {
      const region = await this.getBucketRegionAsync(bucketName);
      const date = new Date();
      const dateStr = (0, _helper.makeDateLong)(date);
      await this.checkAndRefreshCreds();
      if (!postPolicy.policy.expiration) {
        // 'expiration' is mandatory field for S3.
        // Set default expiration date of 7 days.
        const expires = new Date();
        expires.setSeconds(_helpers.PRESIGN_EXPIRY_DAYS_MAX);
        postPolicy.setExpires(expires);
      }
      postPolicy.policy.conditions.push(['eq', '$x-amz-date', dateStr]);
      postPolicy.formData['x-amz-date'] = dateStr;
      postPolicy.policy.conditions.push(['eq', '$x-amz-algorithm', 'AWS4-HMAC-SHA256']);
      postPolicy.formData['x-amz-algorithm'] = 'AWS4-HMAC-SHA256';
      postPolicy.policy.conditions.push(['eq', '$x-amz-credential', this.accessKey + '/' + (0, _helper.getScope)(region, date)]);
      postPolicy.formData['x-amz-credential'] = this.accessKey + '/' + (0, _helper.getScope)(region, date);
      if (this.sessionToken) {
        postPolicy.policy.conditions.push(['eq', '$x-amz-security-token', this.sessionToken]);
        postPolicy.formData['x-amz-security-token'] = this.sessionToken;
      }
      const policyBase64 = Buffer.from(JSON.stringify(postPolicy.policy)).toString('base64');
      postPolicy.formData.policy = policyBase64;
      postPolicy.formData['x-amz-signature'] = (0, _signing.postPresignSignatureV4)(region, date, this.secretKey, policyBase64);
      const opts = {
        region: region,
        bucketName: bucketName,
        method: 'POST'
      };
      const reqOptions = this.getRequestOptions(opts);
      const portStr = this.port == 80 || this.port === 443 ? '' : `:${this.port.toString()}`;
      const urlStr = `${reqOptions.protocol}//${reqOptions.host}${portStr}${reqOptions.path}`;
      return {
        postURL: urlStr,
        formData: postPolicy.formData
      };
    } catch (er) {
      throw new errors.InvalidArgumentError(`Unable to get bucket region for  ${bucketName}.`);
    }
  }
}
exports.TypedClient = TypedClient;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJmcyIsImh0dHAiLCJodHRwcyIsInBhdGgiLCJzdHJlYW0iLCJhc3luYyIsIl9ibG9ja1N0cmVhbSIsIl9icm93c2VyT3JOb2RlIiwiX2xvZGFzaCIsInFzIiwiX3htbDJqcyIsIl9DcmVkZW50aWFsUHJvdmlkZXIiLCJlcnJvcnMiLCJfaGVscGVycyIsIl9zaWduaW5nIiwiX2FzeW5jMiIsIl9jb3B5Q29uZGl0aW9ucyIsIl9leHRlbnNpb25zIiwiX2hlbHBlciIsIl9qb2luSG9zdFBvcnQiLCJfcG9zdFBvbGljeSIsIl9yZXF1ZXN0IiwiX3Jlc3BvbnNlIiwiX3MzRW5kcG9pbnRzIiwieG1sUGFyc2VycyIsIl9nZXRSZXF1aXJlV2lsZGNhcmRDYWNoZSIsIm5vZGVJbnRlcm9wIiwiV2Vha01hcCIsImNhY2hlQmFiZWxJbnRlcm9wIiwiY2FjaGVOb2RlSW50ZXJvcCIsIm9iaiIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiY2FjaGUiLCJoYXMiLCJnZXQiLCJuZXdPYmoiLCJoYXNQcm9wZXJ0eURlc2NyaXB0b3IiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsImtleSIsInByb3RvdHlwZSIsImhhc093blByb3BlcnR5IiwiY2FsbCIsImRlc2MiLCJzZXQiLCJ4bWwiLCJ4bWwyanMiLCJCdWlsZGVyIiwicmVuZGVyT3B0cyIsInByZXR0eSIsImhlYWRsZXNzIiwiUGFja2FnZSIsInZlcnNpb24iLCJyZXF1ZXN0T3B0aW9uUHJvcGVydGllcyIsIlR5cGVkQ2xpZW50IiwicGFydFNpemUiLCJtYXhpbXVtUGFydFNpemUiLCJtYXhPYmplY3RTaXplIiwiY29uc3RydWN0b3IiLCJwYXJhbXMiLCJzZWN1cmUiLCJ1bmRlZmluZWQiLCJFcnJvciIsInVzZVNTTCIsInBvcnQiLCJpc1ZhbGlkRW5kcG9pbnQiLCJlbmRQb2ludCIsIkludmFsaWRFbmRwb2ludEVycm9yIiwiaXNWYWxpZFBvcnQiLCJJbnZhbGlkQXJndW1lbnRFcnJvciIsImlzQm9vbGVhbiIsInJlZ2lvbiIsImlzU3RyaW5nIiwiaG9zdCIsInRvTG93ZXJDYXNlIiwicHJvdG9jb2wiLCJ0cmFuc3BvcnQiLCJ0cmFuc3BvcnRBZ2VudCIsImdsb2JhbEFnZW50IiwiaXNPYmplY3QiLCJsaWJyYXJ5Q29tbWVudHMiLCJwcm9jZXNzIiwicGxhdGZvcm0iLCJhcmNoIiwibGlicmFyeUFnZW50IiwidXNlckFnZW50IiwicGF0aFN0eWxlIiwiYWNjZXNzS2V5Iiwic2VjcmV0S2V5Iiwic2Vzc2lvblRva2VuIiwiYW5vbnltb3VzIiwiY3JlZGVudGlhbHNQcm92aWRlciIsInJlZ2lvbk1hcCIsIm92ZXJSaWRlUGFydFNpemUiLCJlbmFibGVTSEEyNTYiLCJzM0FjY2VsZXJhdGVFbmRwb2ludCIsInJlcU9wdGlvbnMiLCJjbGllbnRFeHRlbnNpb25zIiwiRXh0ZW5zaW9ucyIsImV4dGVuc2lvbnMiLCJzZXRTM1RyYW5zZmVyQWNjZWxlcmF0ZSIsInNldFJlcXVlc3RPcHRpb25zIiwib3B0aW9ucyIsIlR5cGVFcnJvciIsIl8iLCJwaWNrIiwiZ2V0QWNjZWxlcmF0ZUVuZFBvaW50SWZTZXQiLCJidWNrZXROYW1lIiwib2JqZWN0TmFtZSIsImlzRW1wdHkiLCJpbmNsdWRlcyIsInNldEFwcEluZm8iLCJhcHBOYW1lIiwiYXBwVmVyc2lvbiIsInRyaW0iLCJnZXRSZXF1ZXN0T3B0aW9ucyIsIm9wdHMiLCJtZXRob2QiLCJoZWFkZXJzIiwicXVlcnkiLCJhZ2VudCIsInZpcnR1YWxIb3N0U3R5bGUiLCJpc1ZpcnR1YWxIb3N0U3R5bGUiLCJ1cmlSZXNvdXJjZUVzY2FwZSIsImlzQW1hem9uRW5kcG9pbnQiLCJhY2NlbGVyYXRlRW5kUG9pbnQiLCJnZXRTM0VuZHBvaW50Iiwiam9pbkhvc3RQb3J0IiwiayIsInYiLCJlbnRyaWVzIiwiYXNzaWduIiwibWFwVmFsdWVzIiwicGlja0J5IiwiaXNEZWZpbmVkIiwidG9TdHJpbmciLCJzZXRDcmVkZW50aWFsc1Byb3ZpZGVyIiwiQ3JlZGVudGlhbFByb3ZpZGVyIiwiY2hlY2tBbmRSZWZyZXNoQ3JlZHMiLCJjcmVkZW50aWFsc0NvbmYiLCJnZXRDcmVkZW50aWFscyIsImdldEFjY2Vzc0tleSIsImdldFNlY3JldEtleSIsImdldFNlc3Npb25Ub2tlbiIsImUiLCJjYXVzZSIsImxvZ0hUVFAiLCJyZXNwb25zZSIsImVyciIsImxvZ1N0cmVhbSIsImlzUmVhZGFibGVTdHJlYW0iLCJsb2dIZWFkZXJzIiwiZm9yRWFjaCIsInJlZGFjdG9yIiwiUmVnRXhwIiwicmVwbGFjZSIsIndyaXRlIiwic3RhdHVzQ29kZSIsImVyckpTT04iLCJKU09OIiwic3RyaW5naWZ5IiwidHJhY2VPbiIsInN0ZG91dCIsInRyYWNlT2ZmIiwibWFrZVJlcXVlc3RBc3luYyIsInBheWxvYWQiLCJleHBlY3RlZENvZGVzIiwiaXNOdW1iZXIiLCJsZW5ndGgiLCJzaGEyNTZzdW0iLCJ0b1NoYTI1NiIsIm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMiLCJtYWtlUmVxdWVzdEFzeW5jT21pdCIsInN0YXR1c0NvZGVzIiwicmVzIiwiZHJhaW5SZXNwb25zZSIsImJvZHkiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImdldEJ1Y2tldFJlZ2lvbkFzeW5jIiwiZGF0ZSIsIkRhdGUiLCJtYWtlRGF0ZUxvbmciLCJhdXRob3JpemF0aW9uIiwic2lnblY0IiwicmVxdWVzdCIsInBhcnNlUmVzcG9uc2VFcnJvciIsImlzVmFsaWRCdWNrZXROYW1lIiwiSW52YWxpZEJ1Y2tldE5hbWVFcnJvciIsImNhY2hlZCIsImV4dHJhY3RSZWdpb25Bc3luYyIsInJlYWRBc1N0cmluZyIsInBhcnNlQnVja2V0UmVnaW9uIiwiREVGQVVMVF9SRUdJT04iLCJpc0Jyb3dzZXIiLCJuYW1lIiwiUmVnaW9uIiwibWFrZVJlcXVlc3QiLCJyZXR1cm5SZXNwb25zZSIsImNiIiwicHJvbSIsInRoZW4iLCJyZXN1bHQiLCJtYWtlUmVxdWVzdFN0cmVhbSIsImV4ZWN1dG9yIiwiZ2V0QnVja2V0UmVnaW9uIiwibWFrZUJ1Y2tldCIsIm1ha2VPcHRzIiwiYnVpbGRPYmplY3QiLCJDcmVhdGVCdWNrZXRDb25maWd1cmF0aW9uIiwiJCIsInhtbG5zIiwiTG9jYXRpb25Db25zdHJhaW50IiwiT2JqZWN0TG9ja2luZyIsImZpbmFsUmVnaW9uIiwicmVxdWVzdE9wdCIsIlMzRXJyb3IiLCJlcnJDb2RlIiwiY29kZSIsImVyclJlZ2lvbiIsImJ1Y2tldEV4aXN0cyIsInJlbW92ZUJ1Y2tldCIsImdldE9iamVjdCIsImdldE9wdHMiLCJpc1ZhbGlkT2JqZWN0TmFtZSIsIkludmFsaWRPYmplY3ROYW1lRXJyb3IiLCJnZXRQYXJ0aWFsT2JqZWN0Iiwib2Zmc2V0IiwicmFuZ2UiLCJzc2VIZWFkZXJzIiwiU1NFQ3VzdG9tZXJBbGdvcml0aG0iLCJTU0VDdXN0b21lcktleSIsIlNTRUN1c3RvbWVyS2V5TUQ1IiwicHJlcGVuZFhBTVpNZXRhIiwiZXhwZWN0ZWRTdGF0dXNDb2RlcyIsInB1c2giLCJmR2V0T2JqZWN0IiwiZmlsZVBhdGgiLCJkb3dubG9hZFRvVG1wRmlsZSIsInBhcnRGaWxlU3RyZWFtIiwib2JqU3RhdCIsInN0YXRPYmplY3QiLCJwYXJ0RmlsZSIsImV0YWciLCJmc3AiLCJta2RpciIsImRpcm5hbWUiLCJyZWN1cnNpdmUiLCJzdGF0cyIsInN0YXQiLCJzaXplIiwiY3JlYXRlV3JpdGVTdHJlYW0iLCJmbGFncyIsImRvd25sb2FkU3RyZWFtIiwic3RyZWFtUHJvbWlzZSIsInBpcGVsaW5lIiwicmVuYW1lIiwic3RhdE9wdHMiLCJwYXJzZUludCIsIm1ldGFEYXRhIiwiZXh0cmFjdE1ldGFkYXRhIiwibGFzdE1vZGlmaWVkIiwidmVyc2lvbklkIiwiZ2V0VmVyc2lvbklkIiwic2FuaXRpemVFVGFnIiwicmVtb3ZlT2JqZWN0IiwicmVtb3ZlT3B0cyIsImdvdmVybmFuY2VCeXBhc3MiLCJmb3JjZURlbGV0ZSIsInF1ZXJ5UGFyYW1zIiwibGlzdEluY29tcGxldGVVcGxvYWRzIiwiYnVja2V0IiwicHJlZml4IiwiaXNWYWxpZFByZWZpeCIsIkludmFsaWRQcmVmaXhFcnJvciIsImRlbGltaXRlciIsImtleU1hcmtlciIsInVwbG9hZElkTWFya2VyIiwidXBsb2FkcyIsImVuZGVkIiwicmVhZFN0cmVhbSIsIlJlYWRhYmxlIiwib2JqZWN0TW9kZSIsIl9yZWFkIiwic2hpZnQiLCJsaXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeSIsInByZWZpeGVzIiwiZWFjaFNlcmllcyIsInVwbG9hZCIsImxpc3RQYXJ0cyIsInVwbG9hZElkIiwicGFydHMiLCJyZWR1Y2UiLCJhY2MiLCJpdGVtIiwiZW1pdCIsImlzVHJ1bmNhdGVkIiwibmV4dEtleU1hcmtlciIsIm5leHRVcGxvYWRJZE1hcmtlciIsInF1ZXJpZXMiLCJ1cmlFc2NhcGUiLCJtYXhVcGxvYWRzIiwic29ydCIsInVuc2hpZnQiLCJqb2luIiwicGFyc2VMaXN0TXVsdGlwYXJ0IiwiaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQiLCJyZWFkQXNCdWZmZXIiLCJwYXJzZUluaXRpYXRlTXVsdGlwYXJ0IiwiYWJvcnRNdWx0aXBhcnRVcGxvYWQiLCJyZXF1ZXN0T3B0aW9ucyIsImZpbmRVcGxvYWRJZCIsIl9sYXRlc3RVcGxvYWQiLCJsYXRlc3RVcGxvYWQiLCJpbml0aWF0ZWQiLCJnZXRUaW1lIiwiY29tcGxldGVNdWx0aXBhcnRVcGxvYWQiLCJldGFncyIsImJ1aWxkZXIiLCJDb21wbGV0ZU11bHRpcGFydFVwbG9hZCIsIlBhcnQiLCJtYXAiLCJQYXJ0TnVtYmVyIiwicGFydCIsIkVUYWciLCJwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0IiwiZXJyTWVzc2FnZSIsIm1hcmtlciIsImxpc3RQYXJ0c1F1ZXJ5IiwicGFyc2VMaXN0UGFydHMiLCJsaXN0QnVja2V0cyIsInJlZ2lvbkNvbmYiLCJodHRwUmVzIiwieG1sUmVzdWx0IiwicGFyc2VMaXN0QnVja2V0IiwiY2FsY3VsYXRlUGFydFNpemUiLCJmUHV0T2JqZWN0IiwiaW5zZXJ0Q29udGVudFR5cGUiLCJsc3RhdCIsInB1dE9iamVjdCIsImNyZWF0ZVJlYWRTdHJlYW0iLCJyZWFkYWJsZVN0cmVhbSIsInN0YXRTaXplIiwiZ2V0Q29udGVudExlbmd0aCIsImJ1ZiIsImZyb20iLCJ1cGxvYWRCdWZmZXIiLCJ1cGxvYWRTdHJlYW0iLCJtZDVzdW0iLCJoYXNoQmluYXJ5Iiwib2xkUGFydHMiLCJlVGFncyIsInByZXZpb3VzVXBsb2FkSWQiLCJvbGRUYWdzIiwiY2h1bmtpZXIiLCJCbG9ja1N0cmVhbTIiLCJ6ZXJvUGFkZGluZyIsIm8iLCJQcm9taXNlIiwiYWxsIiwicmVzb2x2ZSIsInJlamVjdCIsInBpcGUiLCJvbiIsInBhcnROdW1iZXIiLCJjaHVuayIsIm1kNSIsImNyZWF0ZUhhc2giLCJ1cGRhdGUiLCJkaWdlc3QiLCJvbGRQYXJ0IiwicmVtb3ZlQnVja2V0UmVwbGljYXRpb24iLCJzZXRCdWNrZXRSZXBsaWNhdGlvbiIsInJlcGxpY2F0aW9uQ29uZmlnIiwicm9sZSIsInJ1bGVzIiwicmVwbGljYXRpb25QYXJhbXNDb25maWciLCJSZXBsaWNhdGlvbkNvbmZpZ3VyYXRpb24iLCJSb2xlIiwiUnVsZSIsInRvTWQ1IiwiZ2V0QnVja2V0UmVwbGljYXRpb24iLCJwYXJzZVJlcGxpY2F0aW9uQ29uZmlnIiwiZ2V0T2JqZWN0TGVnYWxIb2xkIiwia2V5cyIsInN0clJlcyIsInBhcnNlT2JqZWN0TGVnYWxIb2xkQ29uZmlnIiwic2V0T2JqZWN0TGVnYWxIb2xkIiwic2V0T3B0cyIsInN0YXR1cyIsIkxFR0FMX0hPTERfU1RBVFVTIiwiRU5BQkxFRCIsIkRJU0FCTEVEIiwiY29uZmlnIiwiU3RhdHVzIiwicm9vdE5hbWUiLCJnZXRCdWNrZXRUYWdnaW5nIiwicGFyc2VUYWdnaW5nIiwiZ2V0T2JqZWN0VGFnZ2luZyIsInNldEJ1Y2tldFBvbGljeSIsInBvbGljeSIsIkludmFsaWRCdWNrZXRQb2xpY3lFcnJvciIsImdldEJ1Y2tldFBvbGljeSIsInB1dE9iamVjdFJldGVudGlvbiIsInJldGVudGlvbk9wdHMiLCJtb2RlIiwiUkVURU5USU9OX01PREVTIiwiQ09NUExJQU5DRSIsIkdPVkVSTkFOQ0UiLCJyZXRhaW5VbnRpbERhdGUiLCJNb2RlIiwiUmV0YWluVW50aWxEYXRlIiwiZ2V0T2JqZWN0TG9ja0NvbmZpZyIsInBhcnNlT2JqZWN0TG9ja0NvbmZpZyIsInNldE9iamVjdExvY2tDb25maWciLCJsb2NrQ29uZmlnT3B0cyIsInJldGVudGlvbk1vZGVzIiwidmFsaWRVbml0cyIsIlJFVEVOVElPTl9WQUxJRElUWV9VTklUUyIsIkRBWVMiLCJZRUFSUyIsInVuaXQiLCJ2YWxpZGl0eSIsIk9iamVjdExvY2tFbmFibGVkIiwiY29uZmlnS2V5cyIsImlzQWxsS2V5c1NldCIsImV2ZXJ5IiwibGNrIiwiRGVmYXVsdFJldGVudGlvbiIsIkRheXMiLCJZZWFycyIsImdldEJ1Y2tldFZlcnNpb25pbmciLCJwYXJzZUJ1Y2tldFZlcnNpb25pbmdDb25maWciLCJzZXRCdWNrZXRWZXJzaW9uaW5nIiwidmVyc2lvbkNvbmZpZyIsInNldFRhZ2dpbmciLCJ0YWdnaW5nUGFyYW1zIiwidGFncyIsInB1dE9wdHMiLCJ0YWdzTGlzdCIsInZhbHVlIiwiS2V5IiwiVmFsdWUiLCJ0YWdnaW5nQ29uZmlnIiwiVGFnZ2luZyIsIlRhZ1NldCIsIlRhZyIsInBheWxvYWRCdWYiLCJyZW1vdmVUYWdnaW5nIiwic2V0QnVja2V0VGFnZ2luZyIsInJlbW92ZUJ1Y2tldFRhZ2dpbmciLCJzZXRPYmplY3RUYWdnaW5nIiwicmVtb3ZlT2JqZWN0VGFnZ2luZyIsInNlbGVjdE9iamVjdENvbnRlbnQiLCJzZWxlY3RPcHRzIiwiZXhwcmVzc2lvbiIsImlucHV0U2VyaWFsaXphdGlvbiIsIm91dHB1dFNlcmlhbGl6YXRpb24iLCJFeHByZXNzaW9uIiwiRXhwcmVzc2lvblR5cGUiLCJleHByZXNzaW9uVHlwZSIsIklucHV0U2VyaWFsaXphdGlvbiIsIk91dHB1dFNlcmlhbGl6YXRpb24iLCJyZXF1ZXN0UHJvZ3Jlc3MiLCJSZXF1ZXN0UHJvZ3Jlc3MiLCJzY2FuUmFuZ2UiLCJTY2FuUmFuZ2UiLCJwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZSIsImFwcGx5QnVja2V0TGlmZWN5Y2xlIiwicG9saWN5Q29uZmlnIiwicmVtb3ZlQnVja2V0TGlmZWN5Y2xlIiwic2V0QnVja2V0TGlmZWN5Y2xlIiwibGlmZUN5Y2xlQ29uZmlnIiwiZ2V0QnVja2V0TGlmZWN5Y2xlIiwicGFyc2VMaWZlY3ljbGVDb25maWciLCJzZXRCdWNrZXRFbmNyeXB0aW9uIiwiZW5jcnlwdGlvbkNvbmZpZyIsImVuY3J5cHRpb25PYmoiLCJBcHBseVNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0IiwiU1NFQWxnb3JpdGhtIiwiZ2V0QnVja2V0RW5jcnlwdGlvbiIsInBhcnNlQnVja2V0RW5jcnlwdGlvbkNvbmZpZyIsInJlbW92ZUJ1Y2tldEVuY3J5cHRpb24iLCJnZXRPYmplY3RSZXRlbnRpb24iLCJwYXJzZU9iamVjdFJldGVudGlvbkNvbmZpZyIsInJlbW92ZU9iamVjdHMiLCJvYmplY3RzTGlzdCIsIkFycmF5IiwiaXNBcnJheSIsInJ1bkRlbGV0ZU9iamVjdHMiLCJiYXRjaCIsImRlbE9iamVjdHMiLCJWZXJzaW9uSWQiLCJyZW1PYmplY3RzIiwiRGVsZXRlIiwiUXVpZXQiLCJyZW1vdmVPYmplY3RzUGFyc2VyIiwibWF4RW50cmllcyIsImJhdGNoZXMiLCJpIiwic2xpY2UiLCJiYXRjaFJlc3VsdHMiLCJmbGF0IiwicmVtb3ZlSW5jb21wbGV0ZVVwbG9hZCIsIklzVmFsaWRCdWNrZXROYW1lRXJyb3IiLCJyZW1vdmVVcGxvYWRJZCIsImNvcHlPYmplY3RWMSIsInRhcmdldEJ1Y2tldE5hbWUiLCJ0YXJnZXRPYmplY3ROYW1lIiwic291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUiLCJjb25kaXRpb25zIiwiQ29weUNvbmRpdGlvbnMiLCJtb2RpZmllZCIsInVubW9kaWZpZWQiLCJtYXRjaEVUYWciLCJtYXRjaEVUYWdFeGNlcHQiLCJwYXJzZUNvcHlPYmplY3QiLCJjb3B5T2JqZWN0VjIiLCJzb3VyY2VDb25maWciLCJkZXN0Q29uZmlnIiwiQ29weVNvdXJjZU9wdGlvbnMiLCJDb3B5RGVzdGluYXRpb25PcHRpb25zIiwidmFsaWRhdGUiLCJnZXRIZWFkZXJzIiwiQnVja2V0IiwiY29weVJlcyIsInJlc0hlYWRlcnMiLCJzaXplSGVhZGVyVmFsdWUiLCJMYXN0TW9kaWZpZWQiLCJNZXRhRGF0YSIsIlNvdXJjZVZlcnNpb25JZCIsImdldFNvdXJjZVZlcnNpb25JZCIsIkV0YWciLCJTaXplIiwiY29weU9iamVjdCIsImFsbEFyZ3MiLCJzb3VyY2UiLCJkZXN0IiwidXBsb2FkUGFydCIsInBhcnRDb25maWciLCJ1cGxvYWRJRCIsInBhcnRSZXMiLCJ1cGxvYWRQYXJ0UGFyc2VyIiwiY29tcG9zZU9iamVjdCIsImRlc3RPYmpDb25maWciLCJzb3VyY2VPYmpMaXN0Iiwic291cmNlRmlsZXNMZW5ndGgiLCJQQVJUX0NPTlNUUkFJTlRTIiwiTUFYX1BBUlRTX0NPVU5UIiwic09iaiIsImdldFN0YXRPcHRpb25zIiwic3JjQ29uZmlnIiwiVmVyc2lvbklEIiwic3JjT2JqZWN0U2l6ZXMiLCJ0b3RhbFNpemUiLCJ0b3RhbFBhcnRzIiwic291cmNlT2JqU3RhdHMiLCJzcmNJdGVtIiwic3JjT2JqZWN0SW5mb3MiLCJ2YWxpZGF0ZWRTdGF0cyIsInJlc0l0ZW1TdGF0IiwiaW5kZXgiLCJzcmNDb3B5U2l6ZSIsIk1hdGNoUmFuZ2UiLCJzcmNTdGFydCIsIlN0YXJ0Iiwic3JjRW5kIiwiRW5kIiwiQUJTX01JTl9QQVJUX1NJWkUiLCJNQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSIsInBhcnRzUmVxdWlyZWQiLCJNQVhfUEFSVF9TSVpFIiwiTWF0Y2hFVGFnIiwic3BsaXRQYXJ0U2l6ZUxpc3QiLCJpZHgiLCJjYWxjdWxhdGVFdmVuU3BsaXRzIiwiZ2V0VXBsb2FkUGFydENvbmZpZ0xpc3QiLCJ1cGxvYWRQYXJ0Q29uZmlnTGlzdCIsInNwbGl0U2l6ZSIsInNwbGl0SW5kZXgiLCJzdGFydEluZGV4Iiwic3RhcnRJZHgiLCJlbmRJbmRleCIsImVuZElkeCIsIm9iakluZm8iLCJvYmpDb25maWciLCJwYXJ0SW5kZXgiLCJ0b3RhbFVwbG9hZHMiLCJzcGxpdFN0YXJ0IiwidXBsZEN0cklkeCIsInNwbGl0RW5kIiwic291cmNlT2JqIiwidXBsb2FkUGFydENvbmZpZyIsInVwbG9hZEFsbFBhcnRzIiwidXBsb2FkTGlzdCIsInBhcnRVcGxvYWRzIiwicGVyZm9ybVVwbG9hZFBhcnRzIiwicGFydHNSZXMiLCJwYXJ0Q29weSIsIm5ld1VwbG9hZEhlYWRlcnMiLCJwYXJ0c0RvbmUiLCJwcmVzaWduZWRVcmwiLCJleHBpcmVzIiwicmVxUGFyYW1zIiwicmVxdWVzdERhdGUiLCJfcmVxdWVzdERhdGUiLCJBbm9ueW1vdXNSZXF1ZXN0RXJyb3IiLCJQUkVTSUdOX0VYUElSWV9EQVlTX01BWCIsImlzTmFOIiwicHJlc2lnblNpZ25hdHVyZVY0IiwicHJlc2lnbmVkR2V0T2JqZWN0IiwicmVzcEhlYWRlcnMiLCJ2YWxpZFJlc3BIZWFkZXJzIiwiaGVhZGVyIiwicHJlc2lnbmVkUHV0T2JqZWN0IiwibmV3UG9zdFBvbGljeSIsIlBvc3RQb2xpY3kiLCJwcmVzaWduZWRQb3N0UG9saWN5IiwicG9zdFBvbGljeSIsImZvcm1EYXRhIiwiZGF0ZVN0ciIsImV4cGlyYXRpb24iLCJzZXRTZWNvbmRzIiwic2V0RXhwaXJlcyIsImdldFNjb3BlIiwicG9saWN5QmFzZTY0IiwicG9zdFByZXNpZ25TaWduYXR1cmVWNCIsInBvcnRTdHIiLCJ1cmxTdHIiLCJwb3N0VVJMIiwiZXIiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiY2xpZW50LnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdub2RlOmNyeXB0bydcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnXG5pbXBvcnQgdHlwZSB7IEluY29taW5nSHR0cEhlYWRlcnMgfSBmcm9tICdub2RlOmh0dHAnXG5pbXBvcnQgKiBhcyBodHRwIGZyb20gJ25vZGU6aHR0cCdcbmltcG9ydCAqIGFzIGh0dHBzIGZyb20gJ25vZGU6aHR0cHMnXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCAqIGFzIHN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcblxuaW1wb3J0ICogYXMgYXN5bmMgZnJvbSAnYXN5bmMnXG5pbXBvcnQgQmxvY2tTdHJlYW0yIGZyb20gJ2Jsb2NrLXN0cmVhbTInXG5pbXBvcnQgeyBpc0Jyb3dzZXIgfSBmcm9tICdicm93c2VyLW9yLW5vZGUnXG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnXG5pbXBvcnQgKiBhcyBxcyBmcm9tICdxdWVyeS1zdHJpbmcnXG5pbXBvcnQgeG1sMmpzIGZyb20gJ3htbDJqcydcblxuaW1wb3J0IHsgQ3JlZGVudGlhbFByb3ZpZGVyIH0gZnJvbSAnLi4vQ3JlZGVudGlhbFByb3ZpZGVyLnRzJ1xuaW1wb3J0ICogYXMgZXJyb3JzIGZyb20gJy4uL2Vycm9ycy50cydcbmltcG9ydCB0eXBlIHsgU2VsZWN0UmVzdWx0cyB9IGZyb20gJy4uL2hlbHBlcnMudHMnXG5pbXBvcnQge1xuICBDb3B5RGVzdGluYXRpb25PcHRpb25zLFxuICBDb3B5U291cmNlT3B0aW9ucyxcbiAgREVGQVVMVF9SRUdJT04sXG4gIExFR0FMX0hPTERfU1RBVFVTLFxuICBQUkVTSUdOX0VYUElSWV9EQVlTX01BWCxcbiAgUkVURU5USU9OX01PREVTLFxuICBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMsXG59IGZyb20gJy4uL2hlbHBlcnMudHMnXG5pbXBvcnQgdHlwZSB7IFBvc3RQb2xpY3lSZXN1bHQgfSBmcm9tICcuLi9taW5pbydcbmltcG9ydCB7IHBvc3RQcmVzaWduU2lnbmF0dXJlVjQsIHByZXNpZ25TaWduYXR1cmVWNCwgc2lnblY0IH0gZnJvbSAnLi4vc2lnbmluZy50cydcbmltcG9ydCB7IGZzcCwgc3RyZWFtUHJvbWlzZSB9IGZyb20gJy4vYXN5bmMudHMnXG5pbXBvcnQgeyBDb3B5Q29uZGl0aW9ucyB9IGZyb20gJy4vY29weS1jb25kaXRpb25zLnRzJ1xuaW1wb3J0IHsgRXh0ZW5zaW9ucyB9IGZyb20gJy4vZXh0ZW5zaW9ucy50cydcbmltcG9ydCB7XG4gIGNhbGN1bGF0ZUV2ZW5TcGxpdHMsXG4gIGV4dHJhY3RNZXRhZGF0YSxcbiAgZ2V0Q29udGVudExlbmd0aCxcbiAgZ2V0U2NvcGUsXG4gIGdldFNvdXJjZVZlcnNpb25JZCxcbiAgZ2V0VmVyc2lvbklkLFxuICBoYXNoQmluYXJ5LFxuICBpbnNlcnRDb250ZW50VHlwZSxcbiAgaXNBbWF6b25FbmRwb2ludCxcbiAgaXNCb29sZWFuLFxuICBpc0RlZmluZWQsXG4gIGlzRW1wdHksXG4gIGlzTnVtYmVyLFxuICBpc09iamVjdCxcbiAgaXNSZWFkYWJsZVN0cmVhbSxcbiAgaXNTdHJpbmcsXG4gIGlzVmFsaWRCdWNrZXROYW1lLFxuICBpc1ZhbGlkRW5kcG9pbnQsXG4gIGlzVmFsaWRPYmplY3ROYW1lLFxuICBpc1ZhbGlkUG9ydCxcbiAgaXNWYWxpZFByZWZpeCxcbiAgaXNWaXJ0dWFsSG9zdFN0eWxlLFxuICBtYWtlRGF0ZUxvbmcsXG4gIFBBUlRfQ09OU1RSQUlOVFMsXG4gIHBhcnRzUmVxdWlyZWQsXG4gIHByZXBlbmRYQU1aTWV0YSxcbiAgcmVhZGFibGVTdHJlYW0sXG4gIHNhbml0aXplRVRhZyxcbiAgdG9NZDUsXG4gIHRvU2hhMjU2LFxuICB1cmlFc2NhcGUsXG4gIHVyaVJlc291cmNlRXNjYXBlLFxufSBmcm9tICcuL2hlbHBlci50cydcbmltcG9ydCB7IGpvaW5Ib3N0UG9ydCB9IGZyb20gJy4vam9pbi1ob3N0LXBvcnQudHMnXG5pbXBvcnQgeyBQb3N0UG9saWN5IH0gZnJvbSAnLi9wb3N0LXBvbGljeS50cydcbmltcG9ydCB7IHJlcXVlc3QgfSBmcm9tICcuL3JlcXVlc3QudHMnXG5pbXBvcnQgeyBkcmFpblJlc3BvbnNlLCByZWFkQXNCdWZmZXIsIHJlYWRBc1N0cmluZyB9IGZyb20gJy4vcmVzcG9uc2UudHMnXG5pbXBvcnQgdHlwZSB7IFJlZ2lvbiB9IGZyb20gJy4vczMtZW5kcG9pbnRzLnRzJ1xuaW1wb3J0IHsgZ2V0UzNFbmRwb2ludCB9IGZyb20gJy4vczMtZW5kcG9pbnRzLnRzJ1xuaW1wb3J0IHR5cGUge1xuICBCaW5hcnksXG4gIEJ1Y2tldEl0ZW1Gcm9tTGlzdCxcbiAgQnVja2V0SXRlbVN0YXQsXG4gIEJ1Y2tldFN0cmVhbSxcbiAgQnVja2V0VmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24sXG4gIENvcHlPYmplY3RQYXJhbXMsXG4gIENvcHlPYmplY3RSZXN1bHQsXG4gIENvcHlPYmplY3RSZXN1bHRWMixcbiAgRW5jcnlwdGlvbkNvbmZpZyxcbiAgR2V0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgR2V0T2JqZWN0T3B0cyxcbiAgR2V0T2JqZWN0UmV0ZW50aW9uT3B0cyxcbiAgSW5jb21wbGV0ZVVwbG9hZGVkQnVja2V0SXRlbSxcbiAgSVJlcXVlc3QsXG4gIEl0ZW1CdWNrZXRNZXRhZGF0YSxcbiAgTGlmZWN5Y2xlQ29uZmlnLFxuICBMaWZlQ3ljbGVDb25maWdQYXJhbSxcbiAgT2JqZWN0TG9ja0NvbmZpZ1BhcmFtLFxuICBPYmplY3RMb2NrSW5mbyxcbiAgT2JqZWN0TWV0YURhdGEsXG4gIE9iamVjdFJldGVudGlvbkluZm8sXG4gIFByZVNpZ25SZXF1ZXN0UGFyYW1zLFxuICBQdXRPYmplY3RMZWdhbEhvbGRPcHRpb25zLFxuICBQdXRUYWdnaW5nUGFyYW1zLFxuICBSZW1vdmVPYmplY3RzUGFyYW0sXG4gIFJlbW92ZU9iamVjdHNSZXF1ZXN0RW50cnksXG4gIFJlbW92ZU9iamVjdHNSZXNwb25zZSxcbiAgUmVtb3ZlVGFnZ2luZ1BhcmFtcyxcbiAgUmVwbGljYXRpb25Db25maWcsXG4gIFJlcGxpY2F0aW9uQ29uZmlnT3B0cyxcbiAgUmVxdWVzdEhlYWRlcnMsXG4gIFJlc3BvbnNlSGVhZGVyLFxuICBSZXN1bHRDYWxsYmFjayxcbiAgUmV0ZW50aW9uLFxuICBTZWxlY3RPcHRpb25zLFxuICBTdGF0T2JqZWN0T3B0cyxcbiAgVGFnLFxuICBUYWdnaW5nT3B0cyxcbiAgVGFncyxcbiAgVHJhbnNwb3J0LFxuICBVcGxvYWRlZE9iamVjdEluZm8sXG4gIFVwbG9hZFBhcnRDb25maWcsXG59IGZyb20gJy4vdHlwZS50cydcbmltcG9ydCB0eXBlIHsgTGlzdE11bHRpcGFydFJlc3VsdCwgVXBsb2FkZWRQYXJ0IH0gZnJvbSAnLi94bWwtcGFyc2VyLnRzJ1xuaW1wb3J0ICogYXMgeG1sUGFyc2VycyBmcm9tICcuL3htbC1wYXJzZXIudHMnXG5pbXBvcnQge1xuICBwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0LFxuICBwYXJzZUluaXRpYXRlTXVsdGlwYXJ0LFxuICBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyxcbiAgcGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UsXG4gIHVwbG9hZFBhcnRQYXJzZXIsXG59IGZyb20gJy4veG1sLXBhcnNlci50cydcblxuY29uc3QgeG1sID0gbmV3IHhtbDJqcy5CdWlsZGVyKHsgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXG5cbi8vIHdpbGwgYmUgcmVwbGFjZWQgYnkgYnVuZGxlci5cbmNvbnN0IFBhY2thZ2UgPSB7IHZlcnNpb246IHByb2Nlc3MuZW52Lk1JTklPX0pTX1BBQ0tBR0VfVkVSU0lPTiB8fCAnZGV2ZWxvcG1lbnQnIH1cblxuY29uc3QgcmVxdWVzdE9wdGlvblByb3BlcnRpZXMgPSBbXG4gICdhZ2VudCcsXG4gICdjYScsXG4gICdjZXJ0JyxcbiAgJ2NpcGhlcnMnLFxuICAnY2xpZW50Q2VydEVuZ2luZScsXG4gICdjcmwnLFxuICAnZGhwYXJhbScsXG4gICdlY2RoQ3VydmUnLFxuICAnZmFtaWx5JyxcbiAgJ2hvbm9yQ2lwaGVyT3JkZXInLFxuICAna2V5JyxcbiAgJ3Bhc3NwaHJhc2UnLFxuICAncGZ4JyxcbiAgJ3JlamVjdFVuYXV0aG9yaXplZCcsXG4gICdzZWN1cmVPcHRpb25zJyxcbiAgJ3NlY3VyZVByb3RvY29sJyxcbiAgJ3NlcnZlcm5hbWUnLFxuICAnc2Vzc2lvbklkQ29udGV4dCcsXG5dIGFzIGNvbnN0XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2xpZW50T3B0aW9ucyB7XG4gIGVuZFBvaW50OiBzdHJpbmdcbiAgYWNjZXNzS2V5OiBzdHJpbmdcbiAgc2VjcmV0S2V5OiBzdHJpbmdcbiAgdXNlU1NMPzogYm9vbGVhblxuICBwb3J0PzogbnVtYmVyXG4gIHJlZ2lvbj86IFJlZ2lvblxuICB0cmFuc3BvcnQ/OiBUcmFuc3BvcnRcbiAgc2Vzc2lvblRva2VuPzogc3RyaW5nXG4gIHBhcnRTaXplPzogbnVtYmVyXG4gIHBhdGhTdHlsZT86IGJvb2xlYW5cbiAgY3JlZGVudGlhbHNQcm92aWRlcj86IENyZWRlbnRpYWxQcm92aWRlclxuICBzM0FjY2VsZXJhdGVFbmRwb2ludD86IHN0cmluZ1xuICB0cmFuc3BvcnRBZ2VudD86IGh0dHAuQWdlbnRcbn1cblxuZXhwb3J0IHR5cGUgUmVxdWVzdE9wdGlvbiA9IFBhcnRpYWw8SVJlcXVlc3Q+ICYge1xuICBtZXRob2Q6IHN0cmluZ1xuICBidWNrZXROYW1lPzogc3RyaW5nXG4gIG9iamVjdE5hbWU/OiBzdHJpbmdcbiAgcXVlcnk/OiBzdHJpbmdcbiAgcGF0aFN0eWxlPzogYm9vbGVhblxufVxuXG5leHBvcnQgdHlwZSBOb1Jlc3VsdENhbGxiYWNrID0gKGVycm9yOiB1bmtub3duKSA9PiB2b2lkXG5cbmV4cG9ydCBpbnRlcmZhY2UgTWFrZUJ1Y2tldE9wdCB7XG4gIE9iamVjdExvY2tpbmc/OiBib29sZWFuXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVtb3ZlT3B0aW9ucyB7XG4gIHZlcnNpb25JZD86IHN0cmluZ1xuICBnb3Zlcm5hbmNlQnlwYXNzPzogYm9vbGVhblxuICBmb3JjZURlbGV0ZT86IGJvb2xlYW5cbn1cblxudHlwZSBQYXJ0ID0ge1xuICBwYXJ0OiBudW1iZXJcbiAgZXRhZzogc3RyaW5nXG59XG5cbmV4cG9ydCBjbGFzcyBUeXBlZENsaWVudCB7XG4gIHByb3RlY3RlZCB0cmFuc3BvcnQ6IFRyYW5zcG9ydFxuICBwcm90ZWN0ZWQgaG9zdDogc3RyaW5nXG4gIHByb3RlY3RlZCBwb3J0OiBudW1iZXJcbiAgcHJvdGVjdGVkIHByb3RvY29sOiBzdHJpbmdcbiAgcHJvdGVjdGVkIGFjY2Vzc0tleTogc3RyaW5nXG4gIHByb3RlY3RlZCBzZWNyZXRLZXk6IHN0cmluZ1xuICBwcm90ZWN0ZWQgc2Vzc2lvblRva2VuPzogc3RyaW5nXG4gIHByb3RlY3RlZCB1c2VyQWdlbnQ6IHN0cmluZ1xuICBwcm90ZWN0ZWQgYW5vbnltb3VzOiBib29sZWFuXG4gIHByb3RlY3RlZCBwYXRoU3R5bGU6IGJvb2xlYW5cbiAgcHJvdGVjdGVkIHJlZ2lvbk1hcDogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuICBwdWJsaWMgcmVnaW9uPzogc3RyaW5nXG4gIHByb3RlY3RlZCBjcmVkZW50aWFsc1Byb3ZpZGVyPzogQ3JlZGVudGlhbFByb3ZpZGVyXG4gIHBhcnRTaXplOiBudW1iZXIgPSA2NCAqIDEwMjQgKiAxMDI0XG4gIHByb3RlY3RlZCBvdmVyUmlkZVBhcnRTaXplPzogYm9vbGVhblxuXG4gIHByb3RlY3RlZCBtYXhpbXVtUGFydFNpemUgPSA1ICogMTAyNCAqIDEwMjQgKiAxMDI0XG4gIHByb3RlY3RlZCBtYXhPYmplY3RTaXplID0gNSAqIDEwMjQgKiAxMDI0ICogMTAyNCAqIDEwMjRcbiAgcHVibGljIGVuYWJsZVNIQTI1NjogYm9vbGVhblxuICBwcm90ZWN0ZWQgczNBY2NlbGVyYXRlRW5kcG9pbnQ/OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHJlcU9wdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG5cbiAgcHJvdGVjdGVkIHRyYW5zcG9ydEFnZW50OiBodHRwLkFnZW50XG4gIHByaXZhdGUgcmVhZG9ubHkgY2xpZW50RXh0ZW5zaW9uczogRXh0ZW5zaW9uc1xuXG4gIGNvbnN0cnVjdG9yKHBhcmFtczogQ2xpZW50T3B0aW9ucykge1xuICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgZGVwcmVjYXRlZCBwcm9wZXJ0eVxuICAgIGlmIChwYXJhbXMuc2VjdXJlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignXCJzZWN1cmVcIiBvcHRpb24gZGVwcmVjYXRlZCwgXCJ1c2VTU0xcIiBzaG91bGQgYmUgdXNlZCBpbnN0ZWFkJylcbiAgICB9XG4gICAgLy8gRGVmYXVsdCB2YWx1ZXMgaWYgbm90IHNwZWNpZmllZC5cbiAgICBpZiAocGFyYW1zLnVzZVNTTCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXJhbXMudXNlU1NMID0gdHJ1ZVxuICAgIH1cbiAgICBpZiAoIXBhcmFtcy5wb3J0KSB7XG4gICAgICBwYXJhbXMucG9ydCA9IDBcbiAgICB9XG4gICAgLy8gVmFsaWRhdGUgaW5wdXQgcGFyYW1zLlxuICAgIGlmICghaXNWYWxpZEVuZHBvaW50KHBhcmFtcy5lbmRQb2ludCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEVuZHBvaW50RXJyb3IoYEludmFsaWQgZW5kUG9pbnQgOiAke3BhcmFtcy5lbmRQb2ludH1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRQb3J0KHBhcmFtcy5wb3J0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCBwb3J0IDogJHtwYXJhbXMucG9ydH1gKVxuICAgIH1cbiAgICBpZiAoIWlzQm9vbGVhbihwYXJhbXMudXNlU1NMKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgYEludmFsaWQgdXNlU1NMIGZsYWcgdHlwZSA6ICR7cGFyYW1zLnVzZVNTTH0sIGV4cGVjdGVkIHRvIGJlIG9mIHR5cGUgXCJib29sZWFuXCJgLFxuICAgICAgKVxuICAgIH1cblxuICAgIC8vIFZhbGlkYXRlIHJlZ2lvbiBvbmx5IGlmIGl0cyBzZXQuXG4gICAgaWYgKHBhcmFtcy5yZWdpb24pIHtcbiAgICAgIGlmICghaXNTdHJpbmcocGFyYW1zLnJlZ2lvbikpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCByZWdpb24gOiAke3BhcmFtcy5yZWdpb259YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBob3N0ID0gcGFyYW1zLmVuZFBvaW50LnRvTG93ZXJDYXNlKClcbiAgICBsZXQgcG9ydCA9IHBhcmFtcy5wb3J0XG4gICAgbGV0IHByb3RvY29sOiBzdHJpbmdcbiAgICBsZXQgdHJhbnNwb3J0XG4gICAgbGV0IHRyYW5zcG9ydEFnZW50OiBodHRwLkFnZW50XG4gICAgLy8gVmFsaWRhdGUgaWYgY29uZmlndXJhdGlvbiBpcyBub3QgdXNpbmcgU1NMXG4gICAgLy8gZm9yIGNvbnN0cnVjdGluZyByZWxldmFudCBlbmRwb2ludHMuXG4gICAgaWYgKHBhcmFtcy51c2VTU0wpIHtcbiAgICAgIC8vIERlZmF1bHRzIHRvIHNlY3VyZS5cbiAgICAgIHRyYW5zcG9ydCA9IGh0dHBzXG4gICAgICBwcm90b2NvbCA9ICdodHRwczonXG4gICAgICBwb3J0ID0gcG9ydCB8fCA0NDNcbiAgICAgIHRyYW5zcG9ydEFnZW50ID0gaHR0cHMuZ2xvYmFsQWdlbnRcbiAgICB9IGVsc2Uge1xuICAgICAgdHJhbnNwb3J0ID0gaHR0cFxuICAgICAgcHJvdG9jb2wgPSAnaHR0cDonXG4gICAgICBwb3J0ID0gcG9ydCB8fCA4MFxuICAgICAgdHJhbnNwb3J0QWdlbnQgPSBodHRwLmdsb2JhbEFnZW50XG4gICAgfVxuXG4gICAgLy8gaWYgY3VzdG9tIHRyYW5zcG9ydCBpcyBzZXQsIHVzZSBpdC5cbiAgICBpZiAocGFyYW1zLnRyYW5zcG9ydCkge1xuICAgICAgaWYgKCFpc09iamVjdChwYXJhbXMudHJhbnNwb3J0KSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgIGBJbnZhbGlkIHRyYW5zcG9ydCB0eXBlIDogJHtwYXJhbXMudHJhbnNwb3J0fSwgZXhwZWN0ZWQgdG8gYmUgdHlwZSBcIm9iamVjdFwiYCxcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgdHJhbnNwb3J0ID0gcGFyYW1zLnRyYW5zcG9ydFxuICAgIH1cblxuICAgIC8vIGlmIGN1c3RvbSB0cmFuc3BvcnQgYWdlbnQgaXMgc2V0LCB1c2UgaXQuXG4gICAgaWYgKHBhcmFtcy50cmFuc3BvcnRBZ2VudCkge1xuICAgICAgaWYgKCFpc09iamVjdChwYXJhbXMudHJhbnNwb3J0QWdlbnQpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgYEludmFsaWQgdHJhbnNwb3J0QWdlbnQgdHlwZTogJHtwYXJhbXMudHJhbnNwb3J0QWdlbnR9LCBleHBlY3RlZCB0byBiZSB0eXBlIFwib2JqZWN0XCJgLFxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIHRyYW5zcG9ydEFnZW50ID0gcGFyYW1zLnRyYW5zcG9ydEFnZW50XG4gICAgfVxuXG4gICAgLy8gVXNlciBBZ2VudCBzaG91bGQgYWx3YXlzIGZvbGxvd2luZyB0aGUgYmVsb3cgc3R5bGUuXG4gICAgLy8gUGxlYXNlIG9wZW4gYW4gaXNzdWUgdG8gZGlzY3VzcyBhbnkgbmV3IGNoYW5nZXMgaGVyZS5cbiAgICAvL1xuICAgIC8vICAgICAgIE1pbklPIChPUzsgQVJDSCkgTElCL1ZFUiBBUFAvVkVSXG4gICAgLy9cbiAgICBjb25zdCBsaWJyYXJ5Q29tbWVudHMgPSBgKCR7cHJvY2Vzcy5wbGF0Zm9ybX07ICR7cHJvY2Vzcy5hcmNofSlgXG4gICAgY29uc3QgbGlicmFyeUFnZW50ID0gYE1pbklPICR7bGlicmFyeUNvbW1lbnRzfSBtaW5pby1qcy8ke1BhY2thZ2UudmVyc2lvbn1gXG4gICAgLy8gVXNlciBhZ2VudCBibG9jayBlbmRzLlxuXG4gICAgdGhpcy50cmFuc3BvcnQgPSB0cmFuc3BvcnRcbiAgICB0aGlzLnRyYW5zcG9ydEFnZW50ID0gdHJhbnNwb3J0QWdlbnRcbiAgICB0aGlzLmhvc3QgPSBob3N0XG4gICAgdGhpcy5wb3J0ID0gcG9ydFxuICAgIHRoaXMucHJvdG9jb2wgPSBwcm90b2NvbFxuICAgIHRoaXMudXNlckFnZW50ID0gYCR7bGlicmFyeUFnZW50fWBcblxuICAgIC8vIERlZmF1bHQgcGF0aCBzdHlsZSBpcyB0cnVlXG4gICAgaWYgKHBhcmFtcy5wYXRoU3R5bGUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5wYXRoU3R5bGUgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucGF0aFN0eWxlID0gcGFyYW1zLnBhdGhTdHlsZVxuICAgIH1cblxuICAgIHRoaXMuYWNjZXNzS2V5ID0gcGFyYW1zLmFjY2Vzc0tleSA/PyAnJ1xuICAgIHRoaXMuc2VjcmV0S2V5ID0gcGFyYW1zLnNlY3JldEtleSA/PyAnJ1xuICAgIHRoaXMuc2Vzc2lvblRva2VuID0gcGFyYW1zLnNlc3Npb25Ub2tlblxuICAgIHRoaXMuYW5vbnltb3VzID0gIXRoaXMuYWNjZXNzS2V5IHx8ICF0aGlzLnNlY3JldEtleVxuXG4gICAgaWYgKHBhcmFtcy5jcmVkZW50aWFsc1Byb3ZpZGVyKSB7XG4gICAgICB0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIgPSBwYXJhbXMuY3JlZGVudGlhbHNQcm92aWRlclxuICAgIH1cblxuICAgIHRoaXMucmVnaW9uTWFwID0ge31cbiAgICBpZiAocGFyYW1zLnJlZ2lvbikge1xuICAgICAgdGhpcy5yZWdpb24gPSBwYXJhbXMucmVnaW9uXG4gICAgfVxuXG4gICAgaWYgKHBhcmFtcy5wYXJ0U2l6ZSkge1xuICAgICAgdGhpcy5wYXJ0U2l6ZSA9IHBhcmFtcy5wYXJ0U2l6ZVxuICAgICAgdGhpcy5vdmVyUmlkZVBhcnRTaXplID0gdHJ1ZVxuICAgIH1cbiAgICBpZiAodGhpcy5wYXJ0U2l6ZSA8IDUgKiAxMDI0ICogMTAyNCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgUGFydCBzaXplIHNob3VsZCBiZSBncmVhdGVyIHRoYW4gNU1CYClcbiAgICB9XG4gICAgaWYgKHRoaXMucGFydFNpemUgPiA1ICogMTAyNCAqIDEwMjQgKiAxMDI0KSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBQYXJ0IHNpemUgc2hvdWxkIGJlIGxlc3MgdGhhbiA1R0JgKVxuICAgIH1cblxuICAgIC8vIFNIQTI1NiBpcyBlbmFibGVkIG9ubHkgZm9yIGF1dGhlbnRpY2F0ZWQgaHR0cCByZXF1ZXN0cy4gSWYgdGhlIHJlcXVlc3QgaXMgYXV0aGVudGljYXRlZFxuICAgIC8vIGFuZCB0aGUgY29ubmVjdGlvbiBpcyBodHRwcyB3ZSB1c2UgeC1hbXotY29udGVudC1zaGEyNTY9VU5TSUdORUQtUEFZTE9BRFxuICAgIC8vIGhlYWRlciBmb3Igc2lnbmF0dXJlIGNhbGN1bGF0aW9uLlxuICAgIHRoaXMuZW5hYmxlU0hBMjU2ID0gIXRoaXMuYW5vbnltb3VzICYmICFwYXJhbXMudXNlU1NMXG5cbiAgICB0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50ID0gcGFyYW1zLnMzQWNjZWxlcmF0ZUVuZHBvaW50IHx8IHVuZGVmaW5lZFxuICAgIHRoaXMucmVxT3B0aW9ucyA9IHt9XG4gICAgdGhpcy5jbGllbnRFeHRlbnNpb25zID0gbmV3IEV4dGVuc2lvbnModGhpcylcbiAgfVxuICAvKipcbiAgICogTWluaW8gZXh0ZW5zaW9ucyB0aGF0IGFyZW4ndCBuZWNlc3NhcnkgcHJlc2VudCBmb3IgQW1hem9uIFMzIGNvbXBhdGlibGUgc3RvcmFnZSBzZXJ2ZXJzXG4gICAqL1xuICBnZXQgZXh0ZW5zaW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnRFeHRlbnNpb25zXG4gIH1cblxuICAvKipcbiAgICogQHBhcmFtIGVuZFBvaW50IC0gdmFsaWQgUzMgYWNjZWxlcmF0aW9uIGVuZCBwb2ludFxuICAgKi9cbiAgc2V0UzNUcmFuc2ZlckFjY2VsZXJhdGUoZW5kUG9pbnQ6IHN0cmluZykge1xuICAgIHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnQgPSBlbmRQb2ludFxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIHN1cHBvcnRlZCByZXF1ZXN0IG9wdGlvbnMuXG4gICAqL1xuICBwdWJsaWMgc2V0UmVxdWVzdE9wdGlvbnMob3B0aW9uczogUGljazxodHRwcy5SZXF1ZXN0T3B0aW9ucywgKHR5cGVvZiByZXF1ZXN0T3B0aW9uUHJvcGVydGllcylbbnVtYmVyXT4pIHtcbiAgICBpZiAoIWlzT2JqZWN0KG9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXF1ZXN0IG9wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIHRoaXMucmVxT3B0aW9ucyA9IF8ucGljayhvcHRpb25zLCByZXF1ZXN0T3B0aW9uUHJvcGVydGllcylcbiAgfVxuXG4gIC8qKlxuICAgKiAgVGhpcyBpcyBzMyBTcGVjaWZpYyBhbmQgZG9lcyBub3QgaG9sZCB2YWxpZGl0eSBpbiBhbnkgb3RoZXIgT2JqZWN0IHN0b3JhZ2UuXG4gICAqL1xuICBwcml2YXRlIGdldEFjY2VsZXJhdGVFbmRQb2ludElmU2V0KGJ1Y2tldE5hbWU/OiBzdHJpbmcsIG9iamVjdE5hbWU/OiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzRW1wdHkodGhpcy5zM0FjY2VsZXJhdGVFbmRwb2ludCkgJiYgIWlzRW1wdHkoYnVja2V0TmFtZSkgJiYgIWlzRW1wdHkob2JqZWN0TmFtZSkpIHtcbiAgICAgIC8vIGh0dHA6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FtYXpvblMzL2xhdGVzdC9kZXYvdHJhbnNmZXItYWNjZWxlcmF0aW9uLmh0bWxcbiAgICAgIC8vIERpc2FibGUgdHJhbnNmZXIgYWNjZWxlcmF0aW9uIGZvciBub24tY29tcGxpYW50IGJ1Y2tldCBuYW1lcy5cbiAgICAgIGlmIChidWNrZXROYW1lLmluY2x1ZGVzKCcuJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUcmFuc2ZlciBBY2NlbGVyYXRpb24gaXMgbm90IHN1cHBvcnRlZCBmb3Igbm9uIGNvbXBsaWFudCBidWNrZXQ6JHtidWNrZXROYW1lfWApXG4gICAgICB9XG4gICAgICAvLyBJZiB0cmFuc2ZlciBhY2NlbGVyYXRpb24gaXMgcmVxdWVzdGVkIHNldCBuZXcgaG9zdC5cbiAgICAgIC8vIEZvciBtb3JlIGRldGFpbHMgYWJvdXQgZW5hYmxpbmcgdHJhbnNmZXIgYWNjZWxlcmF0aW9uIHJlYWQgaGVyZS5cbiAgICAgIC8vIGh0dHA6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FtYXpvblMzL2xhdGVzdC9kZXYvdHJhbnNmZXItYWNjZWxlcmF0aW9uLmh0bWxcbiAgICAgIHJldHVybiB0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50XG4gICAgfVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqICAgU2V0IGFwcGxpY2F0aW9uIHNwZWNpZmljIGluZm9ybWF0aW9uLlxuICAgKiAgIEdlbmVyYXRlcyBVc2VyLUFnZW50IGluIHRoZSBmb2xsb3dpbmcgc3R5bGUuXG4gICAqICAgTWluSU8gKE9TOyBBUkNIKSBMSUIvVkVSIEFQUC9WRVJcbiAgICovXG4gIHNldEFwcEluZm8oYXBwTmFtZTogc3RyaW5nLCBhcHBWZXJzaW9uOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzU3RyaW5nKGFwcE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBJbnZhbGlkIGFwcE5hbWU6ICR7YXBwTmFtZX1gKVxuICAgIH1cbiAgICBpZiAoYXBwTmFtZS50cmltKCkgPT09ICcnKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnB1dCBhcHBOYW1lIGNhbm5vdCBiZSBlbXB0eS4nKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGFwcFZlcnNpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBJbnZhbGlkIGFwcFZlcnNpb246ICR7YXBwVmVyc2lvbn1gKVxuICAgIH1cbiAgICBpZiAoYXBwVmVyc2lvbi50cmltKCkgPT09ICcnKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnB1dCBhcHBWZXJzaW9uIGNhbm5vdCBiZSBlbXB0eS4nKVxuICAgIH1cbiAgICB0aGlzLnVzZXJBZ2VudCA9IGAke3RoaXMudXNlckFnZW50fSAke2FwcE5hbWV9LyR7YXBwVmVyc2lvbn1gXG4gIH1cblxuICAvKipcbiAgICogcmV0dXJucyBvcHRpb25zIG9iamVjdCB0aGF0IGNhbiBiZSB1c2VkIHdpdGggaHR0cC5yZXF1ZXN0KClcbiAgICogVGFrZXMgY2FyZSBvZiBjb25zdHJ1Y3RpbmcgdmlydHVhbC1ob3N0LXN0eWxlIG9yIHBhdGgtc3R5bGUgaG9zdG5hbWVcbiAgICovXG4gIHByb3RlY3RlZCBnZXRSZXF1ZXN0T3B0aW9ucyhcbiAgICBvcHRzOiBSZXF1ZXN0T3B0aW9uICYge1xuICAgICAgcmVnaW9uOiBzdHJpbmdcbiAgICB9LFxuICApOiBJUmVxdWVzdCAmIHtcbiAgICBob3N0OiBzdHJpbmdcbiAgICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIH0ge1xuICAgIGNvbnN0IG1ldGhvZCA9IG9wdHMubWV0aG9kXG4gICAgY29uc3QgcmVnaW9uID0gb3B0cy5yZWdpb25cbiAgICBjb25zdCBidWNrZXROYW1lID0gb3B0cy5idWNrZXROYW1lXG4gICAgbGV0IG9iamVjdE5hbWUgPSBvcHRzLm9iamVjdE5hbWVcbiAgICBjb25zdCBoZWFkZXJzID0gb3B0cy5oZWFkZXJzXG4gICAgY29uc3QgcXVlcnkgPSBvcHRzLnF1ZXJ5XG5cbiAgICBsZXQgcmVxT3B0aW9ucyA9IHtcbiAgICAgIG1ldGhvZCxcbiAgICAgIGhlYWRlcnM6IHt9IGFzIFJlcXVlc3RIZWFkZXJzLFxuICAgICAgcHJvdG9jb2w6IHRoaXMucHJvdG9jb2wsXG4gICAgICAvLyBJZiBjdXN0b20gdHJhbnNwb3J0QWdlbnQgd2FzIHN1cHBsaWVkIGVhcmxpZXIsIHdlJ2xsIGluamVjdCBpdCBoZXJlXG4gICAgICBhZ2VudDogdGhpcy50cmFuc3BvcnRBZ2VudCxcbiAgICB9XG5cbiAgICAvLyBWZXJpZnkgaWYgdmlydHVhbCBob3N0IHN1cHBvcnRlZC5cbiAgICBsZXQgdmlydHVhbEhvc3RTdHlsZVxuICAgIGlmIChidWNrZXROYW1lKSB7XG4gICAgICB2aXJ0dWFsSG9zdFN0eWxlID0gaXNWaXJ0dWFsSG9zdFN0eWxlKHRoaXMuaG9zdCwgdGhpcy5wcm90b2NvbCwgYnVja2V0TmFtZSwgdGhpcy5wYXRoU3R5bGUpXG4gICAgfVxuXG4gICAgbGV0IHBhdGggPSAnLydcbiAgICBsZXQgaG9zdCA9IHRoaXMuaG9zdFxuXG4gICAgbGV0IHBvcnQ6IHVuZGVmaW5lZCB8IG51bWJlclxuICAgIGlmICh0aGlzLnBvcnQpIHtcbiAgICAgIHBvcnQgPSB0aGlzLnBvcnRcbiAgICB9XG5cbiAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgb2JqZWN0TmFtZSA9IHVyaVJlc291cmNlRXNjYXBlKG9iamVjdE5hbWUpXG4gICAgfVxuXG4gICAgLy8gRm9yIEFtYXpvbiBTMyBlbmRwb2ludCwgZ2V0IGVuZHBvaW50IGJhc2VkIG9uIHJlZ2lvbi5cbiAgICBpZiAoaXNBbWF6b25FbmRwb2ludChob3N0KSkge1xuICAgICAgY29uc3QgYWNjZWxlcmF0ZUVuZFBvaW50ID0gdGhpcy5nZXRBY2NlbGVyYXRlRW5kUG9pbnRJZlNldChidWNrZXROYW1lLCBvYmplY3ROYW1lKVxuICAgICAgaWYgKGFjY2VsZXJhdGVFbmRQb2ludCkge1xuICAgICAgICBob3N0ID0gYCR7YWNjZWxlcmF0ZUVuZFBvaW50fWBcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGhvc3QgPSBnZXRTM0VuZHBvaW50KHJlZ2lvbilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodmlydHVhbEhvc3RTdHlsZSAmJiAhb3B0cy5wYXRoU3R5bGUpIHtcbiAgICAgIC8vIEZvciBhbGwgaG9zdHMgd2hpY2ggc3VwcG9ydCB2aXJ0dWFsIGhvc3Qgc3R5bGUsIGBidWNrZXROYW1lYFxuICAgICAgLy8gaXMgcGFydCBvZiB0aGUgaG9zdG5hbWUgaW4gdGhlIGZvbGxvd2luZyBmb3JtYXQ6XG4gICAgICAvL1xuICAgICAgLy8gIHZhciBob3N0ID0gJ2J1Y2tldE5hbWUuZXhhbXBsZS5jb20nXG4gICAgICAvL1xuICAgICAgaWYgKGJ1Y2tldE5hbWUpIHtcbiAgICAgICAgaG9zdCA9IGAke2J1Y2tldE5hbWV9LiR7aG9zdH1gXG4gICAgICB9XG4gICAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgICBwYXRoID0gYC8ke29iamVjdE5hbWV9YFxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBGb3IgYWxsIFMzIGNvbXBhdGlibGUgc3RvcmFnZSBzZXJ2aWNlcyB3ZSB3aWxsIGZhbGxiYWNrIHRvXG4gICAgICAvLyBwYXRoIHN0eWxlIHJlcXVlc3RzLCB3aGVyZSBgYnVja2V0TmFtZWAgaXMgcGFydCBvZiB0aGUgVVJJXG4gICAgICAvLyBwYXRoLlxuICAgICAgaWYgKGJ1Y2tldE5hbWUpIHtcbiAgICAgICAgcGF0aCA9IGAvJHtidWNrZXROYW1lfWBcbiAgICAgIH1cbiAgICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICAgIHBhdGggPSBgLyR7YnVja2V0TmFtZX0vJHtvYmplY3ROYW1lfWBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocXVlcnkpIHtcbiAgICAgIHBhdGggKz0gYD8ke3F1ZXJ5fWBcbiAgICB9XG4gICAgcmVxT3B0aW9ucy5oZWFkZXJzLmhvc3QgPSBob3N0XG4gICAgaWYgKChyZXFPcHRpb25zLnByb3RvY29sID09PSAnaHR0cDonICYmIHBvcnQgIT09IDgwKSB8fCAocmVxT3B0aW9ucy5wcm90b2NvbCA9PT0gJ2h0dHBzOicgJiYgcG9ydCAhPT0gNDQzKSkge1xuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzLmhvc3QgPSBqb2luSG9zdFBvcnQoaG9zdCwgcG9ydClcbiAgICB9XG5cbiAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3VzZXItYWdlbnQnXSA9IHRoaXMudXNlckFnZW50XG4gICAgaWYgKGhlYWRlcnMpIHtcbiAgICAgIC8vIGhhdmUgYWxsIGhlYWRlciBrZXlzIGluIGxvd2VyIGNhc2UgLSB0byBtYWtlIHNpZ25pbmcgZWFzeVxuICAgICAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMoaGVhZGVycykpIHtcbiAgICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzW2sudG9Mb3dlckNhc2UoKV0gPSB2XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVXNlIGFueSByZXF1ZXN0IG9wdGlvbiBzcGVjaWZpZWQgaW4gbWluaW9DbGllbnQuc2V0UmVxdWVzdE9wdGlvbnMoKVxuICAgIHJlcU9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLnJlcU9wdGlvbnMsIHJlcU9wdGlvbnMpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4ucmVxT3B0aW9ucyxcbiAgICAgIGhlYWRlcnM6IF8ubWFwVmFsdWVzKF8ucGlja0J5KHJlcU9wdGlvbnMuaGVhZGVycywgaXNEZWZpbmVkKSwgKHYpID0+IHYudG9TdHJpbmcoKSksXG4gICAgICBob3N0LFxuICAgICAgcG9ydCxcbiAgICAgIHBhdGgsXG4gICAgfSBzYXRpc2ZpZXMgaHR0cHMuUmVxdWVzdE9wdGlvbnNcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzZXRDcmVkZW50aWFsc1Byb3ZpZGVyKGNyZWRlbnRpYWxzUHJvdmlkZXI6IENyZWRlbnRpYWxQcm92aWRlcikge1xuICAgIGlmICghKGNyZWRlbnRpYWxzUHJvdmlkZXIgaW5zdGFuY2VvZiBDcmVkZW50aWFsUHJvdmlkZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuYWJsZSB0byBnZXQgY3JlZGVudGlhbHMuIEV4cGVjdGVkIGluc3RhbmNlIG9mIENyZWRlbnRpYWxQcm92aWRlcicpXG4gICAgfVxuICAgIHRoaXMuY3JlZGVudGlhbHNQcm92aWRlciA9IGNyZWRlbnRpYWxzUHJvdmlkZXJcbiAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKSB7XG4gICAgaWYgKHRoaXMuY3JlZGVudGlhbHNQcm92aWRlcikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY3JlZGVudGlhbHNDb25mID0gYXdhaXQgdGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyLmdldENyZWRlbnRpYWxzKClcbiAgICAgICAgdGhpcy5hY2Nlc3NLZXkgPSBjcmVkZW50aWFsc0NvbmYuZ2V0QWNjZXNzS2V5KClcbiAgICAgICAgdGhpcy5zZWNyZXRLZXkgPSBjcmVkZW50aWFsc0NvbmYuZ2V0U2VjcmV0S2V5KClcbiAgICAgICAgdGhpcy5zZXNzaW9uVG9rZW4gPSBjcmVkZW50aWFsc0NvbmYuZ2V0U2Vzc2lvblRva2VuKClcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZ2V0IGNyZWRlbnRpYWxzOiAke2V9YCwgeyBjYXVzZTogZSB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgbG9nU3RyZWFtPzogc3RyZWFtLldyaXRhYmxlXG5cbiAgLyoqXG4gICAqIGxvZyB0aGUgcmVxdWVzdCwgcmVzcG9uc2UsIGVycm9yXG4gICAqL1xuICBwcml2YXRlIGxvZ0hUVFAocmVxT3B0aW9uczogSVJlcXVlc3QsIHJlc3BvbnNlOiBodHRwLkluY29taW5nTWVzc2FnZSB8IG51bGwsIGVycj86IHVua25vd24pIHtcbiAgICAvLyBpZiBubyBsb2dTdHJlYW0gYXZhaWxhYmxlIHJldHVybi5cbiAgICBpZiAoIXRoaXMubG9nU3RyZWFtKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChyZXFPcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxT3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlICYmICFpc1JlYWRhYmxlU3RyZWFtKHJlc3BvbnNlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVzcG9uc2Ugc2hvdWxkIGJlIG9mIHR5cGUgXCJTdHJlYW1cIicpXG4gICAgfVxuICAgIGlmIChlcnIgJiYgIShlcnIgaW5zdGFuY2VvZiBFcnJvcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2VyciBzaG91bGQgYmUgb2YgdHlwZSBcIkVycm9yXCInKVxuICAgIH1cbiAgICBjb25zdCBsb2dTdHJlYW0gPSB0aGlzLmxvZ1N0cmVhbVxuICAgIGNvbnN0IGxvZ0hlYWRlcnMgPSAoaGVhZGVyczogUmVxdWVzdEhlYWRlcnMpID0+IHtcbiAgICAgIE9iamVjdC5lbnRyaWVzKGhlYWRlcnMpLmZvckVhY2goKFtrLCB2XSkgPT4ge1xuICAgICAgICBpZiAoayA9PSAnYXV0aG9yaXphdGlvbicpIHtcbiAgICAgICAgICBpZiAoaXNTdHJpbmcodikpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlZGFjdG9yID0gbmV3IFJlZ0V4cCgnU2lnbmF0dXJlPShbMC05YS1mXSspJylcbiAgICAgICAgICAgIHYgPSB2LnJlcGxhY2UocmVkYWN0b3IsICdTaWduYXR1cmU9KipSRURBQ1RFRCoqJylcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgbG9nU3RyZWFtLndyaXRlKGAke2t9OiAke3Z9XFxuYClcbiAgICAgIH0pXG4gICAgICBsb2dTdHJlYW0ud3JpdGUoJ1xcbicpXG4gICAgfVxuICAgIGxvZ1N0cmVhbS53cml0ZShgUkVRVUVTVDogJHtyZXFPcHRpb25zLm1ldGhvZH0gJHtyZXFPcHRpb25zLnBhdGh9XFxuYClcbiAgICBsb2dIZWFkZXJzKHJlcU9wdGlvbnMuaGVhZGVycylcbiAgICBpZiAocmVzcG9uc2UpIHtcbiAgICAgIHRoaXMubG9nU3RyZWFtLndyaXRlKGBSRVNQT05TRTogJHtyZXNwb25zZS5zdGF0dXNDb2RlfVxcbmApXG4gICAgICBsb2dIZWFkZXJzKHJlc3BvbnNlLmhlYWRlcnMgYXMgUmVxdWVzdEhlYWRlcnMpXG4gICAgfVxuICAgIGlmIChlcnIpIHtcbiAgICAgIGxvZ1N0cmVhbS53cml0ZSgnRVJST1IgQk9EWTpcXG4nKVxuICAgICAgY29uc3QgZXJySlNPTiA9IEpTT04uc3RyaW5naWZ5KGVyciwgbnVsbCwgJ1xcdCcpXG4gICAgICBsb2dTdHJlYW0ud3JpdGUoYCR7ZXJySlNPTn1cXG5gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbmFibGUgdHJhY2luZ1xuICAgKi9cbiAgcHVibGljIHRyYWNlT24oc3RyZWFtPzogc3RyZWFtLldyaXRhYmxlKSB7XG4gICAgaWYgKCFzdHJlYW0pIHtcbiAgICAgIHN0cmVhbSA9IHByb2Nlc3Muc3Rkb3V0XG4gICAgfVxuICAgIHRoaXMubG9nU3RyZWFtID0gc3RyZWFtXG4gIH1cblxuICAvKipcbiAgICogRGlzYWJsZSB0cmFjaW5nXG4gICAqL1xuICBwdWJsaWMgdHJhY2VPZmYoKSB7XG4gICAgdGhpcy5sb2dTdHJlYW0gPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBtYWtlUmVxdWVzdCBpcyB0aGUgcHJpbWl0aXZlIHVzZWQgYnkgdGhlIGFwaXMgZm9yIG1ha2luZyBTMyByZXF1ZXN0cy5cbiAgICogcGF5bG9hZCBjYW4gYmUgZW1wdHkgc3RyaW5nIGluIGNhc2Ugb2Ygbm8gcGF5bG9hZC5cbiAgICogc3RhdHVzQ29kZSBpcyB0aGUgZXhwZWN0ZWQgc3RhdHVzQ29kZS4gSWYgcmVzcG9uc2Uuc3RhdHVzQ29kZSBkb2VzIG5vdCBtYXRjaFxuICAgKiB3ZSBwYXJzZSB0aGUgWE1MIGVycm9yIGFuZCBjYWxsIHRoZSBjYWxsYmFjayB3aXRoIHRoZSBlcnJvciBtZXNzYWdlLlxuICAgKlxuICAgKiBBIHZhbGlkIHJlZ2lvbiBpcyBwYXNzZWQgYnkgdGhlIGNhbGxzIC0gbGlzdEJ1Y2tldHMsIG1ha2VCdWNrZXQgYW5kIGdldEJ1Y2tldFJlZ2lvbi5cbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBhc3luYyBtYWtlUmVxdWVzdEFzeW5jKFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgcGF5bG9hZDogQmluYXJ5ID0gJycsXG4gICAgZXhwZWN0ZWRDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcbiAgICByZWdpb24gPSAnJyxcbiAgKTogUHJvbWlzZTxodHRwLkluY29taW5nTWVzc2FnZT4ge1xuICAgIGlmICghaXNPYmplY3Qob3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocGF5bG9hZCkgJiYgIWlzT2JqZWN0KHBheWxvYWQpKSB7XG4gICAgICAvLyBCdWZmZXIgaXMgb2YgdHlwZSAnb2JqZWN0J1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncGF5bG9hZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiIG9yIFwiQnVmZmVyXCInKVxuICAgIH1cbiAgICBleHBlY3RlZENvZGVzLmZvckVhY2goKHN0YXR1c0NvZGUpID0+IHtcbiAgICAgIGlmICghaXNOdW1iZXIoc3RhdHVzQ29kZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhdHVzQ29kZSBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICAgIH1cbiAgICB9KVxuICAgIGlmICghaXNTdHJpbmcocmVnaW9uKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVnaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIW9wdGlvbnMuaGVhZGVycykge1xuICAgICAgb3B0aW9ucy5oZWFkZXJzID0ge31cbiAgICB9XG4gICAgaWYgKG9wdGlvbnMubWV0aG9kID09PSAnUE9TVCcgfHwgb3B0aW9ucy5tZXRob2QgPT09ICdQVVQnIHx8IG9wdGlvbnMubWV0aG9kID09PSAnREVMRVRFJykge1xuICAgICAgb3B0aW9ucy5oZWFkZXJzWydjb250ZW50LWxlbmd0aCddID0gcGF5bG9hZC5sZW5ndGgudG9TdHJpbmcoKVxuICAgIH1cbiAgICBjb25zdCBzaGEyNTZzdW0gPSB0aGlzLmVuYWJsZVNIQTI1NiA/IHRvU2hhMjU2KHBheWxvYWQpIDogJydcbiAgICByZXR1cm4gdGhpcy5tYWtlUmVxdWVzdFN0cmVhbUFzeW5jKG9wdGlvbnMsIHBheWxvYWQsIHNoYTI1NnN1bSwgZXhwZWN0ZWRDb2RlcywgcmVnaW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIG5ldyByZXF1ZXN0IHdpdGggcHJvbWlzZVxuICAgKlxuICAgKiBObyBuZWVkIHRvIGRyYWluIHJlc3BvbnNlLCByZXNwb25zZSBib2R5IGlzIG5vdCB2YWxpZFxuICAgKi9cbiAgYXN5bmMgbWFrZVJlcXVlc3RBc3luY09taXQoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBwYXlsb2FkOiBCaW5hcnkgPSAnJyxcbiAgICBzdGF0dXNDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcbiAgICByZWdpb24gPSAnJyxcbiAgKTogUHJvbWlzZTxPbWl0PGh0dHAuSW5jb21pbmdNZXNzYWdlLCAnb24nPj4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhvcHRpb25zLCBwYXlsb2FkLCBzdGF0dXNDb2RlcywgcmVnaW9uKVxuICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxuICAgIHJldHVybiByZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBtYWtlUmVxdWVzdFN0cmVhbSB3aWxsIGJlIHVzZWQgZGlyZWN0bHkgaW5zdGVhZCBvZiBtYWtlUmVxdWVzdCBpbiBjYXNlIHRoZSBwYXlsb2FkXG4gICAqIGlzIGF2YWlsYWJsZSBhcyBhIHN0cmVhbS4gZm9yIGV4LiBwdXRPYmplY3RcbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBhc3luYyBtYWtlUmVxdWVzdFN0cmVhbUFzeW5jKFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgYm9keTogc3RyZWFtLlJlYWRhYmxlIHwgQmluYXJ5LFxuICAgIHNoYTI1NnN1bTogc3RyaW5nLFxuICAgIHN0YXR1c0NvZGVzOiBudW1iZXJbXSxcbiAgICByZWdpb246IHN0cmluZyxcbiAgKTogUHJvbWlzZTxodHRwLkluY29taW5nTWVzc2FnZT4ge1xuICAgIGlmICghaXNPYmplY3Qob3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghKEJ1ZmZlci5pc0J1ZmZlcihib2R5KSB8fCB0eXBlb2YgYm9keSA9PT0gJ3N0cmluZycgfHwgaXNSZWFkYWJsZVN0cmVhbShib2R5KSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgIGBzdHJlYW0gc2hvdWxkIGJlIGEgQnVmZmVyLCBzdHJpbmcgb3IgcmVhZGFibGUgU3RyZWFtLCBnb3QgJHt0eXBlb2YgYm9keX0gaW5zdGVhZGAsXG4gICAgICApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoc2hhMjU2c3VtKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc2hhMjU2c3VtIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBzdGF0dXNDb2Rlcy5mb3JFYWNoKChzdGF0dXNDb2RlKSA9PiB7XG4gICAgICBpZiAoIWlzTnVtYmVyKHN0YXR1c0NvZGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXR1c0NvZGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgICB9XG4gICAgfSlcbiAgICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlZ2lvbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgLy8gc2hhMjU2c3VtIHdpbGwgYmUgZW1wdHkgZm9yIGFub255bW91cyBvciBodHRwcyByZXF1ZXN0c1xuICAgIGlmICghdGhpcy5lbmFibGVTSEEyNTYgJiYgc2hhMjU2c3VtLmxlbmd0aCAhPT0gMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgc2hhMjU2c3VtIGV4cGVjdGVkIHRvIGJlIGVtcHR5IGZvciBhbm9ueW1vdXMgb3IgaHR0cHMgcmVxdWVzdHNgKVxuICAgIH1cbiAgICAvLyBzaGEyNTZzdW0gc2hvdWxkIGJlIHZhbGlkIGZvciBub24tYW5vbnltb3VzIGh0dHAgcmVxdWVzdHMuXG4gICAgaWYgKHRoaXMuZW5hYmxlU0hBMjU2ICYmIHNoYTI1NnN1bS5sZW5ndGggIT09IDY0KSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHNoYTI1NnN1bSA6ICR7c2hhMjU2c3VtfWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXG5cbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxuICAgIHJlZ2lvbiA9IHJlZ2lvbiB8fCAoYXdhaXQgdGhpcy5nZXRCdWNrZXRSZWdpb25Bc3luYyhvcHRpb25zLmJ1Y2tldE5hbWUhKSlcblxuICAgIGNvbnN0IHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKHsgLi4ub3B0aW9ucywgcmVnaW9uIH0pXG4gICAgaWYgKCF0aGlzLmFub255bW91cykge1xuICAgICAgLy8gRm9yIG5vbi1hbm9ueW1vdXMgaHR0cHMgcmVxdWVzdHMgc2hhMjU2c3VtIGlzICdVTlNJR05FRC1QQVlMT0FEJyBmb3Igc2lnbmF0dXJlIGNhbGN1bGF0aW9uLlxuICAgICAgaWYgKCF0aGlzLmVuYWJsZVNIQTI1Nikge1xuICAgICAgICBzaGEyNTZzdW0gPSAnVU5TSUdORUQtUEFZTE9BRCdcbiAgICAgIH1cbiAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpXG4gICAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3gtYW16LWRhdGUnXSA9IG1ha2VEYXRlTG9uZyhkYXRlKVxuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzWyd4LWFtei1jb250ZW50LXNoYTI1NiddID0gc2hhMjU2c3VtXG4gICAgICBpZiAodGhpcy5zZXNzaW9uVG9rZW4pIHtcbiAgICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzWyd4LWFtei1zZWN1cml0eS10b2tlbiddID0gdGhpcy5zZXNzaW9uVG9rZW5cbiAgICAgIH1cbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVycy5hdXRob3JpemF0aW9uID0gc2lnblY0KHJlcU9wdGlvbnMsIHRoaXMuYWNjZXNzS2V5LCB0aGlzLnNlY3JldEtleSwgcmVnaW9uLCBkYXRlLCBzaGEyNTZzdW0pXG4gICAgfVxuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0KHRoaXMudHJhbnNwb3J0LCByZXFPcHRpb25zLCBib2R5KVxuICAgIGlmICghcmVzcG9uc2Uuc3RhdHVzQ29kZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQlVHOiByZXNwb25zZSBkb2Vzbid0IGhhdmUgYSBzdGF0dXNDb2RlXCIpXG4gICAgfVxuXG4gICAgaWYgKCFzdGF0dXNDb2Rlcy5pbmNsdWRlcyhyZXNwb25zZS5zdGF0dXNDb2RlKSkge1xuICAgICAgLy8gRm9yIGFuIGluY29ycmVjdCByZWdpb24sIFMzIHNlcnZlciBhbHdheXMgc2VuZHMgYmFjayA0MDAuXG4gICAgICAvLyBCdXQgd2Ugd2lsbCBkbyBjYWNoZSBpbnZhbGlkYXRpb24gZm9yIGFsbCBlcnJvcnMgc28gdGhhdCxcbiAgICAgIC8vIGluIGZ1dHVyZSwgaWYgQVdTIFMzIGRlY2lkZXMgdG8gc2VuZCBhIGRpZmZlcmVudCBzdGF0dXMgY29kZSBvclxuICAgICAgLy8gWE1MIGVycm9yIGNvZGUgd2Ugd2lsbCBzdGlsbCB3b3JrIGZpbmUuXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxuICAgICAgZGVsZXRlIHRoaXMucmVnaW9uTWFwW29wdGlvbnMuYnVja2V0TmFtZSFdXG5cbiAgICAgIGNvbnN0IGVyciA9IGF3YWl0IHhtbFBhcnNlcnMucGFyc2VSZXNwb25zZUVycm9yKHJlc3BvbnNlKVxuICAgICAgdGhpcy5sb2dIVFRQKHJlcU9wdGlvbnMsIHJlc3BvbnNlLCBlcnIpXG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG5cbiAgICB0aGlzLmxvZ0hUVFAocmVxT3B0aW9ucywgcmVzcG9uc2UpXG5cbiAgICByZXR1cm4gcmVzcG9uc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBnZXRzIHRoZSByZWdpb24gb2YgdGhlIGJ1Y2tldFxuICAgKlxuICAgKiBAcGFyYW0gYnVja2V0TmFtZVxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBnZXRCdWNrZXRSZWdpb25Bc3luYyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZSA6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cblxuICAgIC8vIFJlZ2lvbiBpcyBzZXQgd2l0aCBjb25zdHJ1Y3RvciwgcmV0dXJuIHRoZSByZWdpb24gcmlnaHQgaGVyZS5cbiAgICBpZiAodGhpcy5yZWdpb24pIHtcbiAgICAgIHJldHVybiB0aGlzLnJlZ2lvblxuICAgIH1cblxuICAgIGNvbnN0IGNhY2hlZCA9IHRoaXMucmVnaW9uTWFwW2J1Y2tldE5hbWVdXG4gICAgaWYgKGNhY2hlZCkge1xuICAgICAgcmV0dXJuIGNhY2hlZFxuICAgIH1cblxuICAgIGNvbnN0IGV4dHJhY3RSZWdpb25Bc3luYyA9IGFzeW5jIChyZXNwb25zZTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpID0+IHtcbiAgICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG4gICAgICBjb25zdCByZWdpb24gPSB4bWxQYXJzZXJzLnBhcnNlQnVja2V0UmVnaW9uKGJvZHkpIHx8IERFRkFVTFRfUkVHSU9OXG4gICAgICB0aGlzLnJlZ2lvbk1hcFtidWNrZXROYW1lXSA9IHJlZ2lvblxuICAgICAgcmV0dXJuIHJlZ2lvblxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbG9jYXRpb24nXG4gICAgLy8gYGdldEJ1Y2tldExvY2F0aW9uYCBiZWhhdmVzIGRpZmZlcmVudGx5IGluIGZvbGxvd2luZyB3YXlzIGZvclxuICAgIC8vIGRpZmZlcmVudCBlbnZpcm9ubWVudHMuXG4gICAgLy9cbiAgICAvLyAtIEZvciBub2RlanMgZW52IHdlIGRlZmF1bHQgdG8gcGF0aCBzdHlsZSByZXF1ZXN0cy5cbiAgICAvLyAtIEZvciBicm93c2VyIGVudiBwYXRoIHN0eWxlIHJlcXVlc3RzIG9uIGJ1Y2tldHMgeWllbGRzIENPUlNcbiAgICAvLyAgIGVycm9yLiBUbyBjaXJjdW12ZW50IHRoaXMgcHJvYmxlbSB3ZSBtYWtlIGEgdmlydHVhbCBob3N0XG4gICAgLy8gICBzdHlsZSByZXF1ZXN0IHNpZ25lZCB3aXRoICd1cy1lYXN0LTEnLiBUaGlzIHJlcXVlc3QgZmFpbHNcbiAgICAvLyAgIHdpdGggYW4gZXJyb3IgJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnLCBhZGRpdGlvbmFsbHlcbiAgICAvLyAgIHRoZSBlcnJvciBYTUwgYWxzbyBwcm92aWRlcyBSZWdpb24gb2YgdGhlIGJ1Y2tldC4gVG8gdmFsaWRhdGVcbiAgICAvLyAgIHRoaXMgcmVnaW9uIGlzIHByb3BlciB3ZSByZXRyeSB0aGUgc2FtZSByZXF1ZXN0IHdpdGggdGhlIG5ld2x5XG4gICAgLy8gICBvYnRhaW5lZCByZWdpb24uXG4gICAgY29uc3QgcGF0aFN0eWxlID0gdGhpcy5wYXRoU3R5bGUgJiYgIWlzQnJvd3NlclxuICAgIGxldCByZWdpb246IHN0cmluZ1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBwYXRoU3R5bGUgfSwgJycsIFsyMDBdLCBERUZBVUxUX1JFR0lPTilcbiAgICAgIHJldHVybiBleHRyYWN0UmVnaW9uQXN5bmMocmVzKVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIGlmICghKGUubmFtZSA9PT0gJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnKSkge1xuICAgICAgICB0aHJvdyBlXG4gICAgICB9XG4gICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIHdlIHNldCBleHRyYSBwcm9wZXJ0aWVzIG9uIGVycm9yIG9iamVjdFxuICAgICAgcmVnaW9uID0gZS5SZWdpb24gYXMgc3RyaW5nXG4gICAgICBpZiAoIXJlZ2lvbikge1xuICAgICAgICB0aHJvdyBlXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgcGF0aFN0eWxlIH0sICcnLCBbMjAwXSwgcmVnaW9uKVxuICAgIHJldHVybiBhd2FpdCBleHRyYWN0UmVnaW9uQXN5bmMocmVzKVxuICB9XG5cbiAgLyoqXG4gICAqIG1ha2VSZXF1ZXN0IGlzIHRoZSBwcmltaXRpdmUgdXNlZCBieSB0aGUgYXBpcyBmb3IgbWFraW5nIFMzIHJlcXVlc3RzLlxuICAgKiBwYXlsb2FkIGNhbiBiZSBlbXB0eSBzdHJpbmcgaW4gY2FzZSBvZiBubyBwYXlsb2FkLlxuICAgKiBzdGF0dXNDb2RlIGlzIHRoZSBleHBlY3RlZCBzdGF0dXNDb2RlLiBJZiByZXNwb25zZS5zdGF0dXNDb2RlIGRvZXMgbm90IG1hdGNoXG4gICAqIHdlIHBhcnNlIHRoZSBYTUwgZXJyb3IgYW5kIGNhbGwgdGhlIGNhbGxiYWNrIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXG4gICAqIEEgdmFsaWQgcmVnaW9uIGlzIHBhc3NlZCBieSB0aGUgY2FsbHMgLSBsaXN0QnVja2V0cywgbWFrZUJ1Y2tldCBhbmRcbiAgICogZ2V0QnVja2V0UmVnaW9uLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgYG1ha2VSZXF1ZXN0QXN5bmNgIGluc3RlYWRcbiAgICovXG4gIG1ha2VSZXF1ZXN0KFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgcGF5bG9hZDogQmluYXJ5ID0gJycsXG4gICAgZXhwZWN0ZWRDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcbiAgICByZWdpb24gPSAnJyxcbiAgICByZXR1cm5SZXNwb25zZTogYm9vbGVhbixcbiAgICBjYjogKGNiOiB1bmtub3duLCByZXN1bHQ6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB2b2lkLFxuICApIHtcbiAgICBsZXQgcHJvbTogUHJvbWlzZTxodHRwLkluY29taW5nTWVzc2FnZT5cbiAgICBpZiAocmV0dXJuUmVzcG9uc2UpIHtcbiAgICAgIHByb20gPSB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMob3B0aW9ucywgcGF5bG9hZCwgZXhwZWN0ZWRDb2RlcywgcmVnaW9uKVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGNvbXBhdGlibGUgZm9yIG9sZCBiZWhhdmlvdXJcbiAgICAgIHByb20gPSB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KG9wdGlvbnMsIHBheWxvYWQsIGV4cGVjdGVkQ29kZXMsIHJlZ2lvbilcbiAgICB9XG5cbiAgICBwcm9tLnRoZW4oXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxuICAgICAgKGVycikgPT4ge1xuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgY2IoZXJyKVxuICAgICAgfSxcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogbWFrZVJlcXVlc3RTdHJlYW0gd2lsbCBiZSB1c2VkIGRpcmVjdGx5IGluc3RlYWQgb2YgbWFrZVJlcXVlc3QgaW4gY2FzZSB0aGUgcGF5bG9hZFxuICAgKiBpcyBhdmFpbGFibGUgYXMgYSBzdHJlYW0uIGZvciBleC4gcHV0T2JqZWN0XG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgbWFrZVJlcXVlc3RTdHJlYW1Bc3luY2AgaW5zdGVhZFxuICAgKi9cbiAgbWFrZVJlcXVlc3RTdHJlYW0oXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBzdHJlYW06IHN0cmVhbS5SZWFkYWJsZSB8IEJ1ZmZlcixcbiAgICBzaGEyNTZzdW06IHN0cmluZyxcbiAgICBzdGF0dXNDb2RlczogbnVtYmVyW10sXG4gICAgcmVnaW9uOiBzdHJpbmcsXG4gICAgcmV0dXJuUmVzcG9uc2U6IGJvb2xlYW4sXG4gICAgY2I6IChjYjogdW5rbm93biwgcmVzdWx0OiBodHRwLkluY29taW5nTWVzc2FnZSkgPT4gdm9pZCxcbiAgKSB7XG4gICAgY29uc3QgZXhlY3V0b3IgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMob3B0aW9ucywgc3RyZWFtLCBzaGEyNTZzdW0sIHN0YXR1c0NvZGVzLCByZWdpb24pXG4gICAgICBpZiAoIXJldHVyblJlc3BvbnNlKSB7XG4gICAgICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzXG4gICAgfVxuXG4gICAgZXhlY3V0b3IoKS50aGVuKFxuICAgICAgKHJlc3VsdCkgPT4gY2IobnVsbCwgcmVzdWx0KSxcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIChlcnIpID0+IGNiKGVyciksXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgZ2V0QnVja2V0UmVnaW9uQXN5bmNgIGluc3RlYWRcbiAgICovXG4gIGdldEJ1Y2tldFJlZ2lvbihidWNrZXROYW1lOiBzdHJpbmcsIGNiOiAoZXJyOiB1bmtub3duLCByZWdpb246IHN0cmluZykgPT4gdm9pZCkge1xuICAgIHJldHVybiB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWUpLnRoZW4oXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgKGVycikgPT4gY2IoZXJyKSxcbiAgICApXG4gIH1cblxuICAvLyBCdWNrZXQgb3BlcmF0aW9uc1xuXG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBidWNrZXQgYGJ1Y2tldE5hbWVgLlxuICAgKlxuICAgKi9cbiAgYXN5bmMgbWFrZUJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcsIHJlZ2lvbjogUmVnaW9uID0gJycsIG1ha2VPcHRzOiBNYWtlQnVja2V0T3B0ID0ge30pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICAvLyBCYWNrd2FyZCBDb21wYXRpYmlsaXR5XG4gICAgaWYgKGlzT2JqZWN0KHJlZ2lvbikpIHtcbiAgICAgIG1ha2VPcHRzID0gcmVnaW9uXG4gICAgICByZWdpb24gPSAnJ1xuICAgIH1cblxuICAgIGlmICghaXNTdHJpbmcocmVnaW9uKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVnaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KG1ha2VPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFrZU9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgbGV0IHBheWxvYWQgPSAnJ1xuXG4gICAgLy8gUmVnaW9uIGFscmVhZHkgc2V0IGluIGNvbnN0cnVjdG9yLCB2YWxpZGF0ZSBpZlxuICAgIC8vIGNhbGxlciByZXF1ZXN0ZWQgYnVja2V0IGxvY2F0aW9uIGlzIHNhbWUuXG4gICAgaWYgKHJlZ2lvbiAmJiB0aGlzLnJlZ2lvbikge1xuICAgICAgaWYgKHJlZ2lvbiAhPT0gdGhpcy5yZWdpb24pIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgQ29uZmlndXJlZCByZWdpb24gJHt0aGlzLnJlZ2lvbn0sIHJlcXVlc3RlZCAke3JlZ2lvbn1gKVxuICAgICAgfVxuICAgIH1cbiAgICAvLyBzZW5kaW5nIG1ha2VCdWNrZXQgcmVxdWVzdCB3aXRoIFhNTCBjb250YWluaW5nICd1cy1lYXN0LTEnIGZhaWxzLiBGb3JcbiAgICAvLyBkZWZhdWx0IHJlZ2lvbiBzZXJ2ZXIgZXhwZWN0cyB0aGUgcmVxdWVzdCB3aXRob3V0IGJvZHlcbiAgICBpZiAocmVnaW9uICYmIHJlZ2lvbiAhPT0gREVGQVVMVF9SRUdJT04pIHtcbiAgICAgIHBheWxvYWQgPSB4bWwuYnVpbGRPYmplY3Qoe1xuICAgICAgICBDcmVhdGVCdWNrZXRDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgJDogeyB4bWxuczogJ2h0dHA6Ly9zMy5hbWF6b25hd3MuY29tL2RvYy8yMDA2LTAzLTAxLycgfSxcbiAgICAgICAgICBMb2NhdGlvbkNvbnN0cmFpbnQ6IHJlZ2lvbixcbiAgICAgICAgfSxcbiAgICAgIH0pXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuXG4gICAgaWYgKG1ha2VPcHRzLk9iamVjdExvY2tpbmcpIHtcbiAgICAgIGhlYWRlcnNbJ3gtYW16LWJ1Y2tldC1vYmplY3QtbG9jay1lbmFibGVkJ10gPSB0cnVlXG4gICAgfVxuXG4gICAgLy8gRm9yIGN1c3RvbSByZWdpb24gY2xpZW50cyAgZGVmYXVsdCB0byBjdXN0b20gcmVnaW9uIHNwZWNpZmllZCBpbiBjbGllbnQgY29uc3RydWN0b3JcbiAgICBjb25zdCBmaW5hbFJlZ2lvbiA9IHRoaXMucmVnaW9uIHx8IHJlZ2lvbiB8fCBERUZBVUxUX1JFR0lPTlxuXG4gICAgY29uc3QgcmVxdWVzdE9wdDogUmVxdWVzdE9wdGlvbiA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBoZWFkZXJzIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHJlcXVlc3RPcHQsIHBheWxvYWQsIFsyMDBdLCBmaW5hbFJlZ2lvbilcbiAgICB9IGNhdGNoIChlcnI6IHVua25vd24pIHtcbiAgICAgIGlmIChyZWdpb24gPT09ICcnIHx8IHJlZ2lvbiA9PT0gREVGQVVMVF9SRUdJT04pIHtcbiAgICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIGVycm9ycy5TM0Vycm9yKSB7XG4gICAgICAgICAgY29uc3QgZXJyQ29kZSA9IGVyci5jb2RlXG4gICAgICAgICAgY29uc3QgZXJyUmVnaW9uID0gZXJyLnJlZ2lvblxuICAgICAgICAgIGlmIChlcnJDb2RlID09PSAnQXV0aG9yaXphdGlvbkhlYWRlck1hbGZvcm1lZCcgJiYgZXJyUmVnaW9uICE9PSAnJykge1xuICAgICAgICAgICAgLy8gUmV0cnkgd2l0aCByZWdpb24gcmV0dXJuZWQgYXMgcGFydCBvZiBlcnJvclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChyZXF1ZXN0T3B0LCBwYXlsb2FkLCBbMjAwXSwgZXJyQ29kZSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUbyBjaGVjayBpZiBhIGJ1Y2tldCBhbHJlYWR5IGV4aXN0cy5cbiAgICovXG4gIGFzeW5jIGJ1Y2tldEV4aXN0cyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnSEVBRCdcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSB9KVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgaWYgKGVyci5jb2RlID09PSAnTm9TdWNoQnVja2V0JyB8fCBlcnIuY29kZSA9PT0gJ05vdEZvdW5kJykge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cbiAgICAgIHRocm93IGVyclxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICBhc3luYyByZW1vdmVCdWNrZXQoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPlxuXG4gIC8qKlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgcHJvbWlzZSBzdHlsZSBBUElcbiAgICovXG4gIHJlbW92ZUJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBOb1Jlc3VsdENhbGxiYWNrKTogdm9pZFxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUgfSwgJycsIFsyMDRdKVxuICAgIGRlbGV0ZSB0aGlzLnJlZ2lvbk1hcFtidWNrZXROYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGxiYWNrIGlzIGNhbGxlZCB3aXRoIHJlYWRhYmxlIHN0cmVhbSBvZiB0aGUgb2JqZWN0IGNvbnRlbnQuXG4gICAqL1xuICBhc3luYyBnZXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGdldE9wdHM6IEdldE9iamVjdE9wdHMgPSB7fSk6IFByb21pc2U8c3RyZWFtLlJlYWRhYmxlPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuZ2V0UGFydGlhbE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCAwLCAwLCBnZXRPcHRzKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGxiYWNrIGlzIGNhbGxlZCB3aXRoIHJlYWRhYmxlIHN0cmVhbSBvZiB0aGUgcGFydGlhbCBvYmplY3QgY29udGVudC5cbiAgICogQHBhcmFtIGJ1Y2tldE5hbWVcbiAgICogQHBhcmFtIG9iamVjdE5hbWVcbiAgICogQHBhcmFtIG9mZnNldFxuICAgKiBAcGFyYW0gbGVuZ3RoIC0gbGVuZ3RoIG9mIHRoZSBvYmplY3QgdGhhdCB3aWxsIGJlIHJlYWQgaW4gdGhlIHN0cmVhbSAob3B0aW9uYWwsIGlmIG5vdCBzcGVjaWZpZWQgd2UgcmVhZCB0aGUgcmVzdCBvZiB0aGUgZmlsZSBmcm9tIHRoZSBvZmZzZXQpXG4gICAqIEBwYXJhbSBnZXRPcHRzXG4gICAqL1xuICBhc3luYyBnZXRQYXJ0aWFsT2JqZWN0KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgb2Zmc2V0OiBudW1iZXIsXG4gICAgbGVuZ3RoID0gMCxcbiAgICBnZXRPcHRzOiBHZXRPYmplY3RPcHRzID0ge30sXG4gICk6IFByb21pc2U8c3RyZWFtLlJlYWRhYmxlPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihvZmZzZXQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvZmZzZXQgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIobGVuZ3RoKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGVuZ3RoIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cblxuICAgIGxldCByYW5nZSA9ICcnXG4gICAgaWYgKG9mZnNldCB8fCBsZW5ndGgpIHtcbiAgICAgIGlmIChvZmZzZXQpIHtcbiAgICAgICAgcmFuZ2UgPSBgYnl0ZXM9JHsrb2Zmc2V0fS1gXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByYW5nZSA9ICdieXRlcz0wLSdcbiAgICAgICAgb2Zmc2V0ID0gMFxuICAgICAgfVxuICAgICAgaWYgKGxlbmd0aCkge1xuICAgICAgICByYW5nZSArPSBgJHsrbGVuZ3RoICsgb2Zmc2V0IC0gMX1gXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgc3NlSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAgIC4uLihnZXRPcHRzLlNTRUN1c3RvbWVyQWxnb3JpdGhtICYmIHtcbiAgICAgICAgJ1gtQW16LVNlcnZlci1TaWRlLUVuY3J5cHRpb24tQ3VzdG9tZXItQWxnb3JpdGhtJzogZ2V0T3B0cy5TU0VDdXN0b21lckFsZ29yaXRobSxcbiAgICAgIH0pLFxuICAgICAgLi4uKGdldE9wdHMuU1NFQ3VzdG9tZXJLZXkgJiYgeyAnWC1BbXotU2VydmVyLVNpZGUtRW5jcnlwdGlvbi1DdXN0b21lci1LZXknOiBnZXRPcHRzLlNTRUN1c3RvbWVyS2V5IH0pLFxuICAgICAgLi4uKGdldE9wdHMuU1NFQ3VzdG9tZXJLZXlNRDUgJiYgeyAnWC1BbXotU2VydmVyLVNpZGUtRW5jcnlwdGlvbi1DdXN0b21lci1LZXktTUQ1JzogZ2V0T3B0cy5TU0VDdXN0b21lcktleU1ENSB9KSxcbiAgICB9XG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHtcbiAgICAgIC4uLnByZXBlbmRYQU1aTWV0YShzc2VIZWFkZXJzKSxcbiAgICAgIC4uLihyYW5nZSAhPT0gJycgJiYgeyByYW5nZSB9KSxcbiAgICB9XG5cbiAgICBjb25zdCBleHBlY3RlZFN0YXR1c0NvZGVzID0gWzIwMF1cbiAgICBpZiAocmFuZ2UpIHtcbiAgICAgIGV4cGVjdGVkU3RhdHVzQ29kZXMucHVzaCgyMDYpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG5cbiAgICBjb25zdCBxdWVyeSA9IHFzLnN0cmluZ2lmeShnZXRPcHRzKVxuICAgIHJldHVybiBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIHF1ZXJ5IH0sICcnLCBleHBlY3RlZFN0YXR1c0NvZGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIGRvd25sb2FkIG9iamVjdCBjb250ZW50IHRvIGEgZmlsZS5cbiAgICogVGhpcyBtZXRob2Qgd2lsbCBjcmVhdGUgYSB0ZW1wIGZpbGUgbmFtZWQgYCR7ZmlsZW5hbWV9LiR7ZXRhZ30ucGFydC5taW5pb2Agd2hlbiBkb3dubG9hZGluZy5cbiAgICpcbiAgICogQHBhcmFtIGJ1Y2tldE5hbWUgLSBuYW1lIG9mIHRoZSBidWNrZXRcbiAgICogQHBhcmFtIG9iamVjdE5hbWUgLSBuYW1lIG9mIHRoZSBvYmplY3RcbiAgICogQHBhcmFtIGZpbGVQYXRoIC0gcGF0aCB0byB3aGljaCB0aGUgb2JqZWN0IGRhdGEgd2lsbCBiZSB3cml0dGVuIHRvXG4gICAqIEBwYXJhbSBnZXRPcHRzIC0gT3B0aW9uYWwgb2JqZWN0IGdldCBvcHRpb25cbiAgICovXG4gIGFzeW5jIGZHZXRPYmplY3QoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBmaWxlUGF0aDogc3RyaW5nLFxuICAgIGdldE9wdHM6IEdldE9iamVjdE9wdHMgPSB7fSxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gSW5wdXQgdmFsaWRhdGlvbi5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGZpbGVQYXRoKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZmlsZVBhdGggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgY29uc3QgZG93bmxvYWRUb1RtcEZpbGUgPSBhc3luYyAoKTogUHJvbWlzZTxzdHJpbmc+ID0+IHtcbiAgICAgIGxldCBwYXJ0RmlsZVN0cmVhbTogc3RyZWFtLldyaXRhYmxlXG4gICAgICBjb25zdCBvYmpTdGF0ID0gYXdhaXQgdGhpcy5zdGF0T2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGdldE9wdHMpXG4gICAgICBjb25zdCBwYXJ0RmlsZSA9IGAke2ZpbGVQYXRofS4ke29ialN0YXQuZXRhZ30ucGFydC5taW5pb2BcblxuICAgICAgYXdhaXQgZnNwLm1rZGlyKHBhdGguZGlybmFtZShmaWxlUGF0aCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pXG5cbiAgICAgIGxldCBvZmZzZXQgPSAwXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzcC5zdGF0KHBhcnRGaWxlKVxuICAgICAgICBpZiAob2JqU3RhdC5zaXplID09PSBzdGF0cy5zaXplKSB7XG4gICAgICAgICAgcmV0dXJuIHBhcnRGaWxlXG4gICAgICAgIH1cbiAgICAgICAgb2Zmc2V0ID0gc3RhdHMuc2l6ZVxuICAgICAgICBwYXJ0RmlsZVN0cmVhbSA9IGZzLmNyZWF0ZVdyaXRlU3RyZWFtKHBhcnRGaWxlLCB7IGZsYWdzOiAnYScgfSlcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgaWYgKGUgaW5zdGFuY2VvZiBFcnJvciAmJiAoZSBhcyB1bmtub3duIGFzIHsgY29kZTogc3RyaW5nIH0pLmNvZGUgPT09ICdFTk9FTlQnKSB7XG4gICAgICAgICAgLy8gZmlsZSBub3QgZXhpc3RcbiAgICAgICAgICBwYXJ0RmlsZVN0cmVhbSA9IGZzLmNyZWF0ZVdyaXRlU3RyZWFtKHBhcnRGaWxlLCB7IGZsYWdzOiAndycgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBvdGhlciBlcnJvciwgbWF5YmUgYWNjZXNzIGRlbnlcbiAgICAgICAgICB0aHJvdyBlXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgZG93bmxvYWRTdHJlYW0gPSBhd2FpdCB0aGlzLmdldFBhcnRpYWxPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgb2Zmc2V0LCAwLCBnZXRPcHRzKVxuXG4gICAgICBhd2FpdCBzdHJlYW1Qcm9taXNlLnBpcGVsaW5lKGRvd25sb2FkU3RyZWFtLCBwYXJ0RmlsZVN0cmVhbSlcbiAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnNwLnN0YXQocGFydEZpbGUpXG4gICAgICBpZiAoc3RhdHMuc2l6ZSA9PT0gb2JqU3RhdC5zaXplKSB7XG4gICAgICAgIHJldHVybiBwYXJ0RmlsZVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NpemUgbWlzbWF0Y2ggYmV0d2VlbiBkb3dubG9hZGVkIGZpbGUgYW5kIHRoZSBvYmplY3QnKVxuICAgIH1cblxuICAgIGNvbnN0IHBhcnRGaWxlID0gYXdhaXQgZG93bmxvYWRUb1RtcEZpbGUoKVxuICAgIGF3YWl0IGZzcC5yZW5hbWUocGFydEZpbGUsIGZpbGVQYXRoKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXQgaW5mb3JtYXRpb24gb2YgdGhlIG9iamVjdC5cbiAgICovXG4gIGFzeW5jIHN0YXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHN0YXRPcHRzOiBTdGF0T2JqZWN0T3B0cyA9IHt9KTogUHJvbWlzZTxCdWNrZXRJdGVtU3RhdD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCFpc09iamVjdChzdGF0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3N0YXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5ID0gcXMuc3RyaW5naWZ5KHN0YXRPcHRzKVxuICAgIGNvbnN0IG1ldGhvZCA9ICdIRUFEJ1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0pXG5cbiAgICByZXR1cm4ge1xuICAgICAgc2l6ZTogcGFyc2VJbnQocmVzLmhlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ10gYXMgc3RyaW5nKSxcbiAgICAgIG1ldGFEYXRhOiBleHRyYWN0TWV0YWRhdGEocmVzLmhlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgICAgbGFzdE1vZGlmaWVkOiBuZXcgRGF0ZShyZXMuaGVhZGVyc1snbGFzdC1tb2RpZmllZCddIGFzIHN0cmluZyksXG4gICAgICB2ZXJzaW9uSWQ6IGdldFZlcnNpb25JZChyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgICBldGFnOiBzYW5pdGl6ZUVUYWcocmVzLmhlYWRlcnMuZXRhZyksXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlT2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCByZW1vdmVPcHRzPzogUmVtb3ZlT3B0aW9ucyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKHJlbW92ZU9wdHMgJiYgIWlzT2JqZWN0KHJlbW92ZU9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZW1vdmVPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgaWYgKHJlbW92ZU9wdHM/LmdvdmVybmFuY2VCeXBhc3MpIHtcbiAgICAgIGhlYWRlcnNbJ1gtQW16LUJ5cGFzcy1Hb3Zlcm5hbmNlLVJldGVudGlvbiddID0gdHJ1ZVxuICAgIH1cbiAgICBpZiAocmVtb3ZlT3B0cz8uZm9yY2VEZWxldGUpIHtcbiAgICAgIGhlYWRlcnNbJ3gtbWluaW8tZm9yY2UtZGVsZXRlJ10gPSB0cnVlXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcnlQYXJhbXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuICAgIGlmIChyZW1vdmVPcHRzPy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5UGFyYW1zLnZlcnNpb25JZCA9IGAke3JlbW92ZU9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgcXVlcnkgPSBxcy5zdHJpbmdpZnkocXVlcnlQYXJhbXMpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBxdWVyeSB9LCAnJywgWzIwMCwgMjA0XSlcbiAgfVxuXG4gIC8vIENhbGxzIGltcGxlbWVudGVkIGJlbG93IGFyZSByZWxhdGVkIHRvIG11bHRpcGFydC5cblxuICBsaXN0SW5jb21wbGV0ZVVwbG9hZHMoXG4gICAgYnVja2V0OiBzdHJpbmcsXG4gICAgcHJlZml4OiBzdHJpbmcsXG4gICAgcmVjdXJzaXZlOiBib29sZWFuLFxuICApOiBCdWNrZXRTdHJlYW08SW5jb21wbGV0ZVVwbG9hZGVkQnVja2V0SXRlbT4ge1xuICAgIGlmIChwcmVmaXggPT09IHVuZGVmaW5lZCkge1xuICAgICAgcHJlZml4ID0gJydcbiAgICB9XG4gICAgaWYgKHJlY3Vyc2l2ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZWN1cnNpdmUgPSBmYWxzZVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkUHJlZml4KHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBJbnZhbGlkIHByZWZpeCA6ICR7cHJlZml4fWApXG4gICAgfVxuICAgIGlmICghaXNCb29sZWFuKHJlY3Vyc2l2ZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlY3Vyc2l2ZSBzaG91bGQgYmUgb2YgdHlwZSBcImJvb2xlYW5cIicpXG4gICAgfVxuICAgIGNvbnN0IGRlbGltaXRlciA9IHJlY3Vyc2l2ZSA/ICcnIDogJy8nXG4gICAgbGV0IGtleU1hcmtlciA9ICcnXG4gICAgbGV0IHVwbG9hZElkTWFya2VyID0gJydcbiAgICBjb25zdCB1cGxvYWRzOiB1bmtub3duW10gPSBbXVxuICAgIGxldCBlbmRlZCA9IGZhbHNlXG5cbiAgICAvLyBUT0RPOiByZWZhY3RvciB0aGlzIHdpdGggYXN5bmMvYXdhaXQgYW5kIGBzdHJlYW0uUmVhZGFibGUuZnJvbWBcbiAgICBjb25zdCByZWFkU3RyZWFtID0gbmV3IHN0cmVhbS5SZWFkYWJsZSh7IG9iamVjdE1vZGU6IHRydWUgfSlcbiAgICByZWFkU3RyZWFtLl9yZWFkID0gKCkgPT4ge1xuICAgICAgLy8gcHVzaCBvbmUgdXBsb2FkIGluZm8gcGVyIF9yZWFkKClcbiAgICAgIGlmICh1cGxvYWRzLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKHVwbG9hZHMuc2hpZnQoKSlcbiAgICAgIH1cbiAgICAgIGlmIChlbmRlZCkge1xuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKG51bGwpXG4gICAgICB9XG4gICAgICB0aGlzLmxpc3RJbmNvbXBsZXRlVXBsb2Fkc1F1ZXJ5KGJ1Y2tldCwgcHJlZml4LCBrZXlNYXJrZXIsIHVwbG9hZElkTWFya2VyLCBkZWxpbWl0ZXIpLnRoZW4oXG4gICAgICAgIChyZXN1bHQpID0+IHtcbiAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgIHJlc3VsdC5wcmVmaXhlcy5mb3JFYWNoKChwcmVmaXgpID0+IHVwbG9hZHMucHVzaChwcmVmaXgpKVxuICAgICAgICAgIGFzeW5jLmVhY2hTZXJpZXMoXG4gICAgICAgICAgICByZXN1bHQudXBsb2FkcyxcbiAgICAgICAgICAgICh1cGxvYWQsIGNiKSA9PiB7XG4gICAgICAgICAgICAgIC8vIGZvciBlYWNoIGluY29tcGxldGUgdXBsb2FkIGFkZCB0aGUgc2l6ZXMgb2YgaXRzIHVwbG9hZGVkIHBhcnRzXG4gICAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgICB0aGlzLmxpc3RQYXJ0cyhidWNrZXQsIHVwbG9hZC5rZXksIHVwbG9hZC51cGxvYWRJZCkudGhlbihcbiAgICAgICAgICAgICAgICAocGFydHM6IFBhcnRbXSkgPT4ge1xuICAgICAgICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgICAgICAgdXBsb2FkLnNpemUgPSBwYXJ0cy5yZWR1Y2UoKGFjYywgaXRlbSkgPT4gYWNjICsgaXRlbS5zaXplLCAwKVxuICAgICAgICAgICAgICAgICAgdXBsb2Fkcy5wdXNoKHVwbG9hZClcbiAgICAgICAgICAgICAgICAgIGNiKClcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIChlcnI6IEVycm9yKSA9PiBjYihlcnIpLFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgKGVycikgPT4ge1xuICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGVycilcbiAgICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAocmVzdWx0LmlzVHJ1bmNhdGVkKSB7XG4gICAgICAgICAgICAgICAga2V5TWFya2VyID0gcmVzdWx0Lm5leHRLZXlNYXJrZXJcbiAgICAgICAgICAgICAgICB1cGxvYWRJZE1hcmtlciA9IHJlc3VsdC5uZXh0VXBsb2FkSWRNYXJrZXJcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBlbmRlZCA9IHRydWVcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgICByZWFkU3RyZWFtLl9yZWFkKClcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgKVxuICAgICAgICB9LFxuICAgICAgICAoZSkgPT4ge1xuICAgICAgICAgIHJlYWRTdHJlYW0uZW1pdCgnZXJyb3InLCBlKVxuICAgICAgICB9LFxuICAgICAgKVxuICAgIH1cbiAgICByZXR1cm4gcmVhZFN0cmVhbVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGxlZCBieSBsaXN0SW5jb21wbGV0ZVVwbG9hZHMgdG8gZmV0Y2ggYSBiYXRjaCBvZiBpbmNvbXBsZXRlIHVwbG9hZHMuXG4gICAqL1xuICBhc3luYyBsaXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgcHJlZml4OiBzdHJpbmcsXG4gICAga2V5TWFya2VyOiBzdHJpbmcsXG4gICAgdXBsb2FkSWRNYXJrZXI6IHN0cmluZyxcbiAgICBkZWxpbWl0ZXI6IHN0cmluZyxcbiAgKTogUHJvbWlzZTxMaXN0TXVsdGlwYXJ0UmVzdWx0PiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoa2V5TWFya2VyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigna2V5TWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkTWFya2VyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWRNYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoZGVsaW1pdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZGVsaW1pdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBjb25zdCBxdWVyaWVzID0gW11cbiAgICBxdWVyaWVzLnB1c2goYHByZWZpeD0ke3VyaUVzY2FwZShwcmVmaXgpfWApXG4gICAgcXVlcmllcy5wdXNoKGBkZWxpbWl0ZXI9JHt1cmlFc2NhcGUoZGVsaW1pdGVyKX1gKVxuXG4gICAgaWYgKGtleU1hcmtlcikge1xuICAgICAgcXVlcmllcy5wdXNoKGBrZXktbWFya2VyPSR7dXJpRXNjYXBlKGtleU1hcmtlcil9YClcbiAgICB9XG4gICAgaWYgKHVwbG9hZElkTWFya2VyKSB7XG4gICAgICBxdWVyaWVzLnB1c2goYHVwbG9hZC1pZC1tYXJrZXI9JHt1cGxvYWRJZE1hcmtlcn1gKVxuICAgIH1cblxuICAgIGNvbnN0IG1heFVwbG9hZHMgPSAxMDAwXG4gICAgcXVlcmllcy5wdXNoKGBtYXgtdXBsb2Fkcz0ke21heFVwbG9hZHN9YClcbiAgICBxdWVyaWVzLnNvcnQoKVxuICAgIHF1ZXJpZXMudW5zaGlmdCgndXBsb2FkcycpXG4gICAgbGV0IHF1ZXJ5ID0gJydcbiAgICBpZiAocXVlcmllcy5sZW5ndGggPiAwKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJpZXMuam9pbignJicpfWBcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaXN0TXVsdGlwYXJ0KGJvZHkpXG4gIH1cblxuICAvKipcbiAgICogSW5pdGlhdGUgYSBuZXcgbXVsdGlwYXJ0IHVwbG9hZC5cbiAgICogQGludGVybmFsXG4gICAqL1xuICBhc3luYyBpbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QoaGVhZGVycykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcignY29udGVudFR5cGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdQT1NUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3VwbG9hZHMnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSwgaGVhZGVycyB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNCdWZmZXIocmVzKVxuICAgIHJldHVybiBwYXJzZUluaXRpYXRlTXVsdGlwYXJ0KGJvZHkudG9TdHJpbmcoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBNZXRob2QgdG8gYWJvcnQgYSBtdWx0aXBhcnQgdXBsb2FkIHJlcXVlc3QgaW4gY2FzZSBvZiBhbnkgZXJyb3JzLlxuICAgKlxuICAgKiBAcGFyYW0gYnVja2V0TmFtZSAtIEJ1Y2tldCBOYW1lXG4gICAqIEBwYXJhbSBvYmplY3ROYW1lIC0gT2JqZWN0IE5hbWVcbiAgICogQHBhcmFtIHVwbG9hZElkIC0gaWQgb2YgYSBtdWx0aXBhcnQgdXBsb2FkIHRvIGNhbmNlbCBkdXJpbmcgY29tcG9zZSBvYmplY3Qgc2VxdWVuY2UuXG4gICAqL1xuICBhc3luYyBhYm9ydE11bHRpcGFydFVwbG9hZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgdXBsb2FkSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgY29uc3QgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cGxvYWRJZH1gXG5cbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lOiBvYmplY3ROYW1lLCBxdWVyeSB9XG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChyZXF1ZXN0T3B0aW9ucywgJycsIFsyMDRdKVxuICB9XG5cbiAgYXN5bmMgZmluZFVwbG9hZElkKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGxldCBsYXRlc3RVcGxvYWQ6IExpc3RNdWx0aXBhcnRSZXN1bHRbJ3VwbG9hZHMnXVtudW1iZXJdIHwgdW5kZWZpbmVkXG4gICAgbGV0IGtleU1hcmtlciA9ICcnXG4gICAgbGV0IHVwbG9hZElkTWFya2VyID0gJydcbiAgICBmb3IgKDs7KSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmxpc3RJbmNvbXBsZXRlVXBsb2Fkc1F1ZXJ5KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGtleU1hcmtlciwgdXBsb2FkSWRNYXJrZXIsICcnKVxuICAgICAgZm9yIChjb25zdCB1cGxvYWQgb2YgcmVzdWx0LnVwbG9hZHMpIHtcbiAgICAgICAgaWYgKHVwbG9hZC5rZXkgPT09IG9iamVjdE5hbWUpIHtcbiAgICAgICAgICBpZiAoIWxhdGVzdFVwbG9hZCB8fCB1cGxvYWQuaW5pdGlhdGVkLmdldFRpbWUoKSA+IGxhdGVzdFVwbG9hZC5pbml0aWF0ZWQuZ2V0VGltZSgpKSB7XG4gICAgICAgICAgICBsYXRlc3RVcGxvYWQgPSB1cGxvYWRcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChyZXN1bHQuaXNUcnVuY2F0ZWQpIHtcbiAgICAgICAga2V5TWFya2VyID0gcmVzdWx0Lm5leHRLZXlNYXJrZXJcbiAgICAgICAgdXBsb2FkSWRNYXJrZXIgPSByZXN1bHQubmV4dFVwbG9hZElkTWFya2VyXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGJyZWFrXG4gICAgfVxuICAgIHJldHVybiBsYXRlc3RVcGxvYWQ/LnVwbG9hZElkXG4gIH1cblxuICAvKipcbiAgICogdGhpcyBjYWxsIHdpbGwgYWdncmVnYXRlIHRoZSBwYXJ0cyBvbiB0aGUgc2VydmVyIGludG8gYSBzaW5nbGUgb2JqZWN0LlxuICAgKi9cbiAgYXN5bmMgY29tcGxldGVNdWx0aXBhcnRVcGxvYWQoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICB1cGxvYWRJZDogc3RyaW5nLFxuICAgIGV0YWdzOiB7XG4gICAgICBwYXJ0OiBudW1iZXJcbiAgICAgIGV0YWc/OiBzdHJpbmdcbiAgICB9W10sXG4gICk6IFByb21pc2U8eyBldGFnOiBzdHJpbmc7IHZlcnNpb25JZDogc3RyaW5nIHwgbnVsbCB9PiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGV0YWdzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZXRhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJBcnJheVwiJylcbiAgICB9XG5cbiAgICBpZiAoIXVwbG9hZElkKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd1cGxvYWRJZCBjYW5ub3QgYmUgZW1wdHknKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQT1NUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXJpRXNjYXBlKHVwbG9hZElkKX1gXG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKClcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdCh7XG4gICAgICBDb21wbGV0ZU11bHRpcGFydFVwbG9hZDoge1xuICAgICAgICAkOiB7XG4gICAgICAgICAgeG1sbnM6ICdodHRwOi8vczMuYW1hem9uYXdzLmNvbS9kb2MvMjAwNi0wMy0wMS8nLFxuICAgICAgICB9LFxuICAgICAgICBQYXJ0OiBldGFncy5tYXAoKGV0YWcpID0+IHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgUGFydE51bWJlcjogZXRhZy5wYXJ0LFxuICAgICAgICAgICAgRVRhZzogZXRhZy5ldGFnLFxuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgIH0pXG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQpXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc0J1ZmZlcihyZXMpXG4gICAgY29uc3QgcmVzdWx0ID0gcGFyc2VDb21wbGV0ZU11bHRpcGFydChib2R5LnRvU3RyaW5nKCkpXG4gICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQlVHOiBmYWlsZWQgdG8gcGFyc2Ugc2VydmVyIHJlc3BvbnNlJylcbiAgICB9XG5cbiAgICBpZiAocmVzdWx0LmVyckNvZGUpIHtcbiAgICAgIC8vIE11bHRpcGFydCBDb21wbGV0ZSBBUEkgcmV0dXJucyBhbiBlcnJvciBYTUwgYWZ0ZXIgYSAyMDAgaHR0cCBzdGF0dXNcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuUzNFcnJvcihyZXN1bHQuZXJyTWVzc2FnZSlcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgZXRhZzogcmVzdWx0LmV0YWcgYXMgc3RyaW5nLFxuICAgICAgdmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzLmhlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgcGFydC1pbmZvIG9mIGFsbCBwYXJ0cyBvZiBhbiBpbmNvbXBsZXRlIHVwbG9hZCBzcGVjaWZpZWQgYnkgdXBsb2FkSWQuXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgbGlzdFBhcnRzKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCB1cGxvYWRJZDogc3RyaW5nKTogUHJvbWlzZTxVcGxvYWRlZFBhcnRbXT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCF1cGxvYWRJZCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndXBsb2FkSWQgY2Fubm90IGJlIGVtcHR5JylcbiAgICB9XG5cbiAgICBjb25zdCBwYXJ0czogVXBsb2FkZWRQYXJ0W10gPSBbXVxuICAgIGxldCBtYXJrZXIgPSAwXG4gICAgbGV0IHJlc3VsdFxuICAgIGRvIHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMubGlzdFBhcnRzUXVlcnkoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdXBsb2FkSWQsIG1hcmtlcilcbiAgICAgIG1hcmtlciA9IHJlc3VsdC5tYXJrZXJcbiAgICAgIHBhcnRzLnB1c2goLi4ucmVzdWx0LnBhcnRzKVxuICAgIH0gd2hpbGUgKHJlc3VsdC5pc1RydW5jYXRlZClcblxuICAgIHJldHVybiBwYXJ0c1xuICB9XG5cbiAgLyoqXG4gICAqIENhbGxlZCBieSBsaXN0UGFydHMgdG8gZmV0Y2ggYSBiYXRjaCBvZiBwYXJ0LWluZm9cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgbGlzdFBhcnRzUXVlcnkoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHVwbG9hZElkOiBzdHJpbmcsIG1hcmtlcjogbnVtYmVyKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKG1hcmtlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKCF1cGxvYWRJZCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndXBsb2FkSWQgY2Fubm90IGJlIGVtcHR5JylcbiAgICB9XG5cbiAgICBsZXQgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cmlFc2NhcGUodXBsb2FkSWQpfWBcbiAgICBpZiAobWFya2VyKSB7XG4gICAgICBxdWVyeSArPSBgJnBhcnQtbnVtYmVyLW1hcmtlcj0ke21hcmtlcn1gXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0pXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaXN0UGFydHMoYXdhaXQgcmVhZEFzU3RyaW5nKHJlcykpXG4gIH1cblxuICBhc3luYyBsaXN0QnVja2V0cygpOiBQcm9taXNlPEJ1Y2tldEl0ZW1Gcm9tTGlzdFtdPiB7XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCByZWdpb25Db25mID0gdGhpcy5yZWdpb24gfHwgREVGQVVMVF9SRUdJT05cbiAgICBjb25zdCBodHRwUmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kIH0sICcnLCBbMjAwXSwgcmVnaW9uQ29uZilcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUxpc3RCdWNrZXQoeG1sUmVzdWx0KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGN1bGF0ZSBwYXJ0IHNpemUgZ2l2ZW4gdGhlIG9iamVjdCBzaXplLiBQYXJ0IHNpemUgd2lsbCBiZSBhdGxlYXN0IHRoaXMucGFydFNpemVcbiAgICovXG4gIGNhbGN1bGF0ZVBhcnRTaXplKHNpemU6IG51bWJlcikge1xuICAgIGlmICghaXNOdW1iZXIoc2l6ZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NpemUgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmIChzaXplID4gdGhpcy5tYXhPYmplY3RTaXplKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBzaXplIHNob3VsZCBub3QgYmUgbW9yZSB0aGFuICR7dGhpcy5tYXhPYmplY3RTaXplfWApXG4gICAgfVxuICAgIGlmICh0aGlzLm92ZXJSaWRlUGFydFNpemUpIHtcbiAgICAgIHJldHVybiB0aGlzLnBhcnRTaXplXG4gICAgfVxuICAgIGxldCBwYXJ0U2l6ZSA9IHRoaXMucGFydFNpemVcbiAgICBmb3IgKDs7KSB7XG4gICAgICAvLyB3aGlsZSh0cnVlKSB7Li4ufSB0aHJvd3MgbGludGluZyBlcnJvci5cbiAgICAgIC8vIElmIHBhcnRTaXplIGlzIGJpZyBlbm91Z2ggdG8gYWNjb21vZGF0ZSB0aGUgb2JqZWN0IHNpemUsIHRoZW4gdXNlIGl0LlxuICAgICAgaWYgKHBhcnRTaXplICogMTAwMDAgPiBzaXplKSB7XG4gICAgICAgIHJldHVybiBwYXJ0U2l6ZVxuICAgICAgfVxuICAgICAgLy8gVHJ5IHBhcnQgc2l6ZXMgYXMgNjRNQiwgODBNQiwgOTZNQiBldGMuXG4gICAgICBwYXJ0U2l6ZSArPSAxNiAqIDEwMjQgKiAxMDI0XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFVwbG9hZHMgdGhlIG9iamVjdCB1c2luZyBjb250ZW50cyBmcm9tIGEgZmlsZVxuICAgKi9cbiAgYXN5bmMgZlB1dE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgbWV0YURhdGE6IE9iamVjdE1ldGFEYXRhID0ge30pIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghaXNTdHJpbmcoZmlsZVBhdGgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdmaWxlUGF0aCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChtZXRhRGF0YSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21ldGFEYXRhIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIC8vIEluc2VydHMgY29ycmVjdCBgY29udGVudC10eXBlYCBhdHRyaWJ1dGUgYmFzZWQgb24gbWV0YURhdGEgYW5kIGZpbGVQYXRoXG4gICAgbWV0YURhdGEgPSBpbnNlcnRDb250ZW50VHlwZShtZXRhRGF0YSwgZmlsZVBhdGgpXG4gICAgY29uc3Qgc3RhdCA9IGF3YWl0IGZzcC5sc3RhdChmaWxlUGF0aClcbiAgICBhd2FpdCB0aGlzLnB1dE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBmcy5jcmVhdGVSZWFkU3RyZWFtKGZpbGVQYXRoKSwgc3RhdC5zaXplLCBtZXRhRGF0YSlcbiAgfVxuXG4gIC8qKlxuICAgKiAgVXBsb2FkaW5nIGEgc3RyZWFtLCBcIkJ1ZmZlclwiIG9yIFwic3RyaW5nXCIuXG4gICAqICBJdCdzIHJlY29tbWVuZGVkIHRvIHBhc3MgYHNpemVgIGFyZ3VtZW50IHdpdGggc3RyZWFtLlxuICAgKi9cbiAgYXN5bmMgcHV0T2JqZWN0KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgc3RyZWFtOiBzdHJlYW0uUmVhZGFibGUgfCBCdWZmZXIgfCBzdHJpbmcsXG4gICAgc2l6ZT86IG51bWJlcixcbiAgICBtZXRhRGF0YT86IEl0ZW1CdWNrZXRNZXRhZGF0YSxcbiAgKTogUHJvbWlzZTxVcGxvYWRlZE9iamVjdEluZm8+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIC8vIFdlJ2xsIG5lZWQgdG8gc2hpZnQgYXJndW1lbnRzIHRvIHRoZSBsZWZ0IGJlY2F1c2Ugb2YgbWV0YURhdGFcbiAgICAvLyBhbmQgc2l6ZSBiZWluZyBvcHRpb25hbC5cbiAgICBpZiAoaXNPYmplY3Qoc2l6ZSkpIHtcbiAgICAgIG1ldGFEYXRhID0gc2l6ZVxuICAgIH1cbiAgICAvLyBFbnN1cmVzIE1ldGFkYXRhIGhhcyBhcHByb3ByaWF0ZSBwcmVmaXggZm9yIEEzIEFQSVxuICAgIGNvbnN0IGhlYWRlcnMgPSBwcmVwZW5kWEFNWk1ldGEobWV0YURhdGEpXG4gICAgaWYgKHR5cGVvZiBzdHJlYW0gPT09ICdzdHJpbmcnIHx8IHN0cmVhbSBpbnN0YW5jZW9mIEJ1ZmZlcikge1xuICAgICAgLy8gQWRhcHRzIHRoZSBub24tc3RyZWFtIGludGVyZmFjZSBpbnRvIGEgc3RyZWFtLlxuICAgICAgc2l6ZSA9IHN0cmVhbS5sZW5ndGhcbiAgICAgIHN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKHN0cmVhbSlcbiAgICB9IGVsc2UgaWYgKCFpc1JlYWRhYmxlU3RyZWFtKHN0cmVhbSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3RoaXJkIGFyZ3VtZW50IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyZWFtLlJlYWRhYmxlXCIgb3IgXCJCdWZmZXJcIiBvciBcInN0cmluZ1wiJylcbiAgICB9XG5cbiAgICBpZiAoaXNOdW1iZXIoc2l6ZSkgJiYgc2l6ZSA8IDApIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYHNpemUgY2Fubm90IGJlIG5lZ2F0aXZlLCBnaXZlbiBzaXplOiAke3NpemV9YClcbiAgICB9XG5cbiAgICAvLyBHZXQgdGhlIHBhcnQgc2l6ZSBhbmQgZm9yd2FyZCB0aGF0IHRvIHRoZSBCbG9ja1N0cmVhbS4gRGVmYXVsdCB0byB0aGVcbiAgICAvLyBsYXJnZXN0IGJsb2NrIHNpemUgcG9zc2libGUgaWYgbmVjZXNzYXJ5LlxuICAgIGlmICghaXNOdW1iZXIoc2l6ZSkpIHtcbiAgICAgIHNpemUgPSB0aGlzLm1heE9iamVjdFNpemVcbiAgICB9XG5cbiAgICAvLyBHZXQgdGhlIHBhcnQgc2l6ZSBhbmQgZm9yd2FyZCB0aGF0IHRvIHRoZSBCbG9ja1N0cmVhbS4gRGVmYXVsdCB0byB0aGVcbiAgICAvLyBsYXJnZXN0IGJsb2NrIHNpemUgcG9zc2libGUgaWYgbmVjZXNzYXJ5LlxuICAgIGlmIChzaXplID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IHN0YXRTaXplID0gYXdhaXQgZ2V0Q29udGVudExlbmd0aChzdHJlYW0pXG4gICAgICBpZiAoc3RhdFNpemUgIT09IG51bGwpIHtcbiAgICAgICAgc2l6ZSA9IHN0YXRTaXplXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc051bWJlcihzaXplKSkge1xuICAgICAgLy8gQmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgc2l6ZSA9IHRoaXMubWF4T2JqZWN0U2l6ZVxuICAgIH1cblxuICAgIGNvbnN0IHBhcnRTaXplID0gdGhpcy5jYWxjdWxhdGVQYXJ0U2l6ZShzaXplKVxuICAgIGlmICh0eXBlb2Ygc3RyZWFtID09PSAnc3RyaW5nJyB8fCBCdWZmZXIuaXNCdWZmZXIoc3RyZWFtKSB8fCBzaXplIDw9IHBhcnRTaXplKSB7XG4gICAgICBjb25zdCBidWYgPSBpc1JlYWRhYmxlU3RyZWFtKHN0cmVhbSkgPyBhd2FpdCByZWFkQXNCdWZmZXIoc3RyZWFtKSA6IEJ1ZmZlci5mcm9tKHN0cmVhbSlcbiAgICAgIHJldHVybiB0aGlzLnVwbG9hZEJ1ZmZlcihidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBidWYpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMudXBsb2FkU3RyZWFtKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIHN0cmVhbSwgcGFydFNpemUpXG4gIH1cblxuICAvKipcbiAgICogbWV0aG9kIHRvIHVwbG9hZCBidWZmZXIgaW4gb25lIGNhbGxcbiAgICogQHByaXZhdGVcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgdXBsb2FkQnVmZmVyKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMsXG4gICAgYnVmOiBCdWZmZXIsXG4gICk6IFByb21pc2U8VXBsb2FkZWRPYmplY3RJbmZvPiB7XG4gICAgY29uc3QgeyBtZDVzdW0sIHNoYTI1NnN1bSB9ID0gaGFzaEJpbmFyeShidWYsIHRoaXMuZW5hYmxlU0hBMjU2KVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTGVuZ3RoJ10gPSBidWYubGVuZ3RoXG4gICAgaWYgKCF0aGlzLmVuYWJsZVNIQTI1Nikge1xuICAgICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IG1kNXN1bVxuICAgIH1cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMoXG4gICAgICB7XG4gICAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICAgIGJ1Y2tldE5hbWUsXG4gICAgICAgIG9iamVjdE5hbWUsXG4gICAgICAgIGhlYWRlcnMsXG4gICAgICB9LFxuICAgICAgYnVmLFxuICAgICAgc2hhMjU2c3VtLFxuICAgICAgWzIwMF0sXG4gICAgICAnJyxcbiAgICApXG4gICAgYXdhaXQgZHJhaW5SZXNwb25zZShyZXMpXG4gICAgcmV0dXJuIHtcbiAgICAgIGV0YWc6IHNhbml0aXplRVRhZyhyZXMuaGVhZGVycy5ldGFnKSxcbiAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogdXBsb2FkIHN0cmVhbSB3aXRoIE11bHRpcGFydFVwbG9hZFxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyB1cGxvYWRTdHJlYW0oXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyxcbiAgICBib2R5OiBzdHJlYW0uUmVhZGFibGUsXG4gICAgcGFydFNpemU6IG51bWJlcixcbiAgKTogUHJvbWlzZTxVcGxvYWRlZE9iamVjdEluZm8+IHtcbiAgICAvLyBBIG1hcCBvZiB0aGUgcHJldmlvdXNseSB1cGxvYWRlZCBjaHVua3MsIGZvciByZXN1bWluZyBhIGZpbGUgdXBsb2FkLiBUaGlzXG4gICAgLy8gd2lsbCBiZSBudWxsIGlmIHdlIGFyZW4ndCByZXN1bWluZyBhbiB1cGxvYWQuXG4gICAgY29uc3Qgb2xkUGFydHM6IFJlY29yZDxudW1iZXIsIFBhcnQ+ID0ge31cblxuICAgIC8vIEtlZXAgdHJhY2sgb2YgdGhlIGV0YWdzIGZvciBhZ2dyZWdhdGluZyB0aGUgY2h1bmtzIHRvZ2V0aGVyIGxhdGVyLiBFYWNoXG4gICAgLy8gZXRhZyByZXByZXNlbnRzIGEgc2luZ2xlIGNodW5rIG9mIHRoZSBmaWxlLlxuICAgIGNvbnN0IGVUYWdzOiBQYXJ0W10gPSBbXVxuXG4gICAgY29uc3QgcHJldmlvdXNVcGxvYWRJZCA9IGF3YWl0IHRoaXMuZmluZFVwbG9hZElkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUpXG4gICAgbGV0IHVwbG9hZElkOiBzdHJpbmdcbiAgICBpZiAoIXByZXZpb3VzVXBsb2FkSWQpIHtcbiAgICAgIHVwbG9hZElkID0gYXdhaXQgdGhpcy5pbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzKVxuICAgIH0gZWxzZSB7XG4gICAgICB1cGxvYWRJZCA9IHByZXZpb3VzVXBsb2FkSWRcbiAgICAgIGNvbnN0IG9sZFRhZ3MgPSBhd2FpdCB0aGlzLmxpc3RQYXJ0cyhidWNrZXROYW1lLCBvYmplY3ROYW1lLCBwcmV2aW91c1VwbG9hZElkKVxuICAgICAgb2xkVGFncy5mb3JFYWNoKChlKSA9PiB7XG4gICAgICAgIG9sZFRhZ3NbZS5wYXJ0XSA9IGVcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29uc3QgY2h1bmtpZXIgPSBuZXcgQmxvY2tTdHJlYW0yKHsgc2l6ZTogcGFydFNpemUsIHplcm9QYWRkaW5nOiBmYWxzZSB9KVxuXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby11bnVzZWQtdmFyc1xuICAgIGNvbnN0IFtfLCBvXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgYm9keS5waXBlKGNodW5raWVyKS5vbignZXJyb3InLCByZWplY3QpXG4gICAgICAgIGNodW5raWVyLm9uKCdlbmQnLCByZXNvbHZlKS5vbignZXJyb3InLCByZWplY3QpXG4gICAgICB9KSxcbiAgICAgIChhc3luYyAoKSA9PiB7XG4gICAgICAgIGxldCBwYXJ0TnVtYmVyID0gMVxuXG4gICAgICAgIGZvciBhd2FpdCAoY29uc3QgY2h1bmsgb2YgY2h1bmtpZXIpIHtcbiAgICAgICAgICBjb25zdCBtZDUgPSBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGNodW5rKS5kaWdlc3QoKVxuXG4gICAgICAgICAgY29uc3Qgb2xkUGFydCA9IG9sZFBhcnRzW3BhcnROdW1iZXJdXG4gICAgICAgICAgaWYgKG9sZFBhcnQpIHtcbiAgICAgICAgICAgIGlmIChvbGRQYXJ0LmV0YWcgPT09IG1kNS50b1N0cmluZygnaGV4JykpIHtcbiAgICAgICAgICAgICAgZVRhZ3MucHVzaCh7IHBhcnQ6IHBhcnROdW1iZXIsIGV0YWc6IG9sZFBhcnQuZXRhZyB9KVxuICAgICAgICAgICAgICBwYXJ0TnVtYmVyKytcbiAgICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwYXJ0TnVtYmVyKytcblxuICAgICAgICAgIC8vIG5vdyBzdGFydCB0byB1cGxvYWQgbWlzc2luZyBwYXJ0XG4gICAgICAgICAgY29uc3Qgb3B0aW9uczogUmVxdWVzdE9wdGlvbiA9IHtcbiAgICAgICAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICAgICAgICBxdWVyeTogcXMuc3RyaW5naWZ5KHsgcGFydE51bWJlciwgdXBsb2FkSWQgfSksXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICdDb250ZW50LUxlbmd0aCc6IGNodW5rLmxlbmd0aCxcbiAgICAgICAgICAgICAgJ0NvbnRlbnQtTUQ1JzogbWQ1LnRvU3RyaW5nKCdiYXNlNjQnKSxcbiAgICAgICAgICAgICAgLi4uaGVhZGVycyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBidWNrZXROYW1lLFxuICAgICAgICAgICAgb2JqZWN0TmFtZSxcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQob3B0aW9ucywgY2h1bmspXG5cbiAgICAgICAgICBsZXQgZXRhZyA9IHJlc3BvbnNlLmhlYWRlcnMuZXRhZ1xuICAgICAgICAgIGlmIChldGFnKSB7XG4gICAgICAgICAgICBldGFnID0gZXRhZy5yZXBsYWNlKC9eXCIvLCAnJykucmVwbGFjZSgvXCIkLywgJycpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGV0YWcgPSAnJ1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGVUYWdzLnB1c2goeyBwYXJ0OiBwYXJ0TnVtYmVyLCBldGFnIH0pXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb21wbGV0ZU11bHRpcGFydFVwbG9hZChidWNrZXROYW1lLCBvYmplY3ROYW1lLCB1cGxvYWRJZCwgZVRhZ3MpXG4gICAgICB9KSgpLFxuICAgIF0pXG5cbiAgICByZXR1cm4gb1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPlxuICByZW1vdmVCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBOb1Jlc3VsdENhbGxiYWNrKTogdm9pZFxuICBhc3luYyByZW1vdmVCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwLCAyMDRdLCAnJylcbiAgfVxuXG4gIHNldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgcmVwbGljYXRpb25Db25maWc6IFJlcGxpY2F0aW9uQ29uZmlnT3B0cyk6IHZvaWRcbiAgYXN5bmMgc2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCByZXBsaWNhdGlvbkNvbmZpZzogUmVwbGljYXRpb25Db25maWdPcHRzKTogUHJvbWlzZTx2b2lkPlxuICBhc3luYyBzZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIHJlcGxpY2F0aW9uQ29uZmlnOiBSZXBsaWNhdGlvbkNvbmZpZ09wdHMpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHJlcGxpY2F0aW9uQ29uZmlnKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVwbGljYXRpb25Db25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChfLmlzRW1wdHkocmVwbGljYXRpb25Db25maWcucm9sZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignUm9sZSBjYW5ub3QgYmUgZW1wdHknKVxuICAgICAgfSBlbHNlIGlmIChyZXBsaWNhdGlvbkNvbmZpZy5yb2xlICYmICFpc1N0cmluZyhyZXBsaWNhdGlvbkNvbmZpZy5yb2xlKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnZhbGlkIHZhbHVlIGZvciByb2xlJywgcmVwbGljYXRpb25Db25maWcucm9sZSlcbiAgICAgIH1cbiAgICAgIGlmIChfLmlzRW1wdHkocmVwbGljYXRpb25Db25maWcucnVsZXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ01pbmltdW0gb25lIHJlcGxpY2F0aW9uIHJ1bGUgbXVzdCBiZSBzcGVjaWZpZWQnKVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuXG4gICAgY29uc3QgcmVwbGljYXRpb25QYXJhbXNDb25maWcgPSB7XG4gICAgICBSZXBsaWNhdGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgUm9sZTogcmVwbGljYXRpb25Db25maWcucm9sZSxcbiAgICAgICAgUnVsZTogcmVwbGljYXRpb25Db25maWcucnVsZXMsXG4gICAgICB9LFxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSwgaGVhZGxlc3M6IHRydWUgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChyZXBsaWNhdGlvblBhcmFtc0NvbmZpZylcbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxuICB9XG5cbiAgZ2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogdm9pZFxuICBhc3luYyBnZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPFJlcGxpY2F0aW9uQ29uZmlnPlxuICBhc3luYyBnZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDAsIDIwNF0pXG4gICAgY29uc3QgeG1sUmVzdWx0ID0gYXdhaXQgcmVhZEFzU3RyaW5nKGh0dHBSZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VSZXBsaWNhdGlvbkNvbmZpZyh4bWxSZXN1bHQpXG4gIH1cblxuICBnZXRPYmplY3RMZWdhbEhvbGQoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBnZXRPcHRzPzogR2V0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgICBjYWxsYmFjaz86IFJlc3VsdENhbGxiYWNrPExFR0FMX0hPTERfU1RBVFVTPixcbiAgKTogUHJvbWlzZTxMRUdBTF9IT0xEX1NUQVRVUz5cbiAgYXN5bmMgZ2V0T2JqZWN0TGVnYWxIb2xkKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZ2V0T3B0cz86IEdldE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXG4gICk6IFByb21pc2U8TEVHQUxfSE9MRF9TVEFUVVM+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChnZXRPcHRzKSB7XG4gICAgICBpZiAoIWlzT2JqZWN0KGdldE9wdHMpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2dldE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJPYmplY3RcIicpXG4gICAgICB9IGVsc2UgaWYgKE9iamVjdC5rZXlzKGdldE9wdHMpLmxlbmd0aCA+IDAgJiYgZ2V0T3B0cy52ZXJzaW9uSWQgJiYgIWlzU3RyaW5nKGdldE9wdHMudmVyc2lvbklkKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2ZXJzaW9uSWQgc2hvdWxkIGJlIG9mIHR5cGUgc3RyaW5nLjonLCBnZXRPcHRzLnZlcnNpb25JZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGxldCBxdWVyeSA9ICdsZWdhbC1ob2xkJ1xuXG4gICAgaWYgKGdldE9wdHM/LnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdKVxuICAgIGNvbnN0IHN0clJlcyA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyhzdHJSZXMpXG4gIH1cblxuICBzZXRPYmplY3RMZWdhbEhvbGQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHNldE9wdHM/OiBQdXRPYmplY3RMZWdhbEhvbGRPcHRpb25zKTogdm9pZFxuICBhc3luYyBzZXRPYmplY3RMZWdhbEhvbGQoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBzZXRPcHRzID0ge1xuICAgICAgc3RhdHVzOiBMRUdBTF9IT0xEX1NUQVRVUy5FTkFCTEVELFxuICAgIH0gYXMgUHV0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIWlzT2JqZWN0KHNldE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwiT2JqZWN0XCInKVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIVtMRUdBTF9IT0xEX1NUQVRVUy5FTkFCTEVELCBMRUdBTF9IT0xEX1NUQVRVUy5ESVNBQkxFRF0uaW5jbHVkZXMoc2V0T3B0cz8uc3RhdHVzKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdJbnZhbGlkIHN0YXR1czogJyArIHNldE9wdHMuc3RhdHVzKVxuICAgICAgfVxuICAgICAgaWYgKHNldE9wdHMudmVyc2lvbklkICYmICFzZXRPcHRzLnZlcnNpb25JZC5sZW5ndGgpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmVyc2lvbklkIHNob3VsZCBiZSBvZiB0eXBlIHN0cmluZy46JyArIHNldE9wdHMudmVyc2lvbklkKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ2xlZ2FsLWhvbGQnXG5cbiAgICBpZiAoc2V0T3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7c2V0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cblxuICAgIGNvbnN0IGNvbmZpZyA9IHtcbiAgICAgIFN0YXR1czogc2V0T3B0cy5zdGF0dXMsXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJvb3ROYW1lOiAnTGVnYWxIb2xkJywgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgVGFncyBhc3NvY2lhdGVkIHdpdGggYSBCdWNrZXRcbiAgICovXG4gIGFzeW5jIGdldEJ1Y2tldFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxUYWdbXT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICd0YWdnaW5nJ1xuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHJlcXVlc3RPcHRpb25zKVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VUYWdnaW5nKGJvZHkpXG4gIH1cblxuICAvKipcbiAgICogIEdldCB0aGUgdGFncyBhc3NvY2lhdGVkIHdpdGggYSBidWNrZXQgT1IgYW4gb2JqZWN0XG4gICAqL1xuICBhc3luYyBnZXRPYmplY3RUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBnZXRPcHRzOiBHZXRPYmplY3RPcHRzID0ge30pOiBQcm9taXNlPFRhZ1tdPiB7XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBsZXQgcXVlcnkgPSAndGFnZ2luZydcblxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBvYmplY3QgbmFtZTogJyArIG9iamVjdE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QoZ2V0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2dldE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgaWYgKGdldE9wdHMgJiYgZ2V0T3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke2dldE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnM6IFJlcXVlc3RPcHRpb24gPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfVxuICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICByZXF1ZXN0T3B0aW9uc1snb2JqZWN0TmFtZSddID0gb2JqZWN0TmFtZVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHJlcXVlc3RPcHRpb25zKVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VUYWdnaW5nKGJvZHkpXG4gIH1cblxuICAvKipcbiAgICogIFNldCB0aGUgcG9saWN5IG9uIGEgYnVja2V0IG9yIGFuIG9iamVjdCBwcmVmaXguXG4gICAqL1xuICBhc3luYyBzZXRCdWNrZXRQb2xpY3koYnVja2V0TmFtZTogc3RyaW5nLCBwb2xpY3k6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIFZhbGlkYXRlIGFyZ3VtZW50cy5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHBvbGljeSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldFBvbGljeUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBwb2xpY3k6ICR7cG9saWN5fSAtIG11c3QgYmUgXCJzdHJpbmdcImApXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcnkgPSAncG9saWN5J1xuXG4gICAgbGV0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgaWYgKHBvbGljeSkge1xuICAgICAgbWV0aG9kID0gJ1BVVCdcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCBwb2xpY3ksIFsyMDRdLCAnJylcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIHBvbGljeSBvbiBhIGJ1Y2tldCBvciBhbiBvYmplY3QgcHJlZml4LlxuICAgKi9cbiAgYXN5bmMgZ2V0QnVja2V0UG9saWN5KGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgLy8gVmFsaWRhdGUgYXJndW1lbnRzLlxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdwb2xpY3knXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIHJldHVybiBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICB9XG5cbiAgYXN5bmMgcHV0T2JqZWN0UmV0ZW50aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCByZXRlbnRpb25PcHRzOiBSZXRlbnRpb24gPSB7fSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QocmV0ZW50aW9uT3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JldGVudGlvbk9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChyZXRlbnRpb25PcHRzLmdvdmVybmFuY2VCeXBhc3MgJiYgIWlzQm9vbGVhbihyZXRlbnRpb25PcHRzLmdvdmVybmFuY2VCeXBhc3MpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgdmFsdWUgZm9yIGdvdmVybmFuY2VCeXBhc3M6ICR7cmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzfWApXG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIHJldGVudGlvbk9wdHMubW9kZSAmJlxuICAgICAgICAhW1JFVEVOVElPTl9NT0RFUy5DT01QTElBTkNFLCBSRVRFTlRJT05fTU9ERVMuR09WRVJOQU5DRV0uaW5jbHVkZXMocmV0ZW50aW9uT3B0cy5tb2RlKVxuICAgICAgKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgb2JqZWN0IHJldGVudGlvbiBtb2RlOiAke3JldGVudGlvbk9wdHMubW9kZX1gKVxuICAgICAgfVxuICAgICAgaWYgKHJldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlICYmICFpc1N0cmluZyhyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCB2YWx1ZSBmb3IgcmV0YWluVW50aWxEYXRlOiAke3JldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlfWApXG4gICAgICB9XG4gICAgICBpZiAocmV0ZW50aW9uT3B0cy52ZXJzaW9uSWQgJiYgIWlzU3RyaW5nKHJldGVudGlvbk9wdHMudmVyc2lvbklkKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHZhbHVlIGZvciB2ZXJzaW9uSWQ6ICR7cmV0ZW50aW9uT3B0cy52ZXJzaW9uSWR9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGxldCBxdWVyeSA9ICdyZXRlbnRpb24nXG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgaWYgKHJldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzcykge1xuICAgICAgaGVhZGVyc1snWC1BbXotQnlwYXNzLUdvdmVybmFuY2UtUmV0ZW50aW9uJ10gPSB0cnVlXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJvb3ROYW1lOiAnUmV0ZW50aW9uJywgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXG4gICAgY29uc3QgcGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cblxuICAgIGlmIChyZXRlbnRpb25PcHRzLm1vZGUpIHtcbiAgICAgIHBhcmFtcy5Nb2RlID0gcmV0ZW50aW9uT3B0cy5tb2RlXG4gICAgfVxuICAgIGlmIChyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZSkge1xuICAgICAgcGFyYW1zLlJldGFpblVudGlsRGF0ZSA9IHJldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlXG4gICAgfVxuICAgIGlmIChyZXRlbnRpb25PcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtyZXRlbnRpb25PcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QocGFyYW1zKVxuXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZCwgWzIwMCwgMjA0XSlcbiAgfVxuXG4gIGdldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nLCBjYWxsYmFjazogUmVzdWx0Q2FsbGJhY2s8T2JqZWN0TG9ja0luZm8+KTogdm9pZFxuICBnZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZyk6IHZvaWRcbiAgYXN5bmMgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPE9iamVjdExvY2tJbmZvPlxuICBhc3luYyBnZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnb2JqZWN0LWxvY2snXG5cbiAgICBjb25zdCBodHRwUmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlT2JqZWN0TG9ja0NvbmZpZyh4bWxSZXN1bHQpXG4gIH1cblxuICBzZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZywgbG9ja0NvbmZpZ09wdHM6IE9taXQ8T2JqZWN0TG9ja0luZm8sICdvYmplY3RMb2NrRW5hYmxlZCc+KTogdm9pZFxuICBhc3luYyBzZXRPYmplY3RMb2NrQ29uZmlnKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBsb2NrQ29uZmlnT3B0czogT21pdDxPYmplY3RMb2NrSW5mbywgJ29iamVjdExvY2tFbmFibGVkJz4sXG4gICk6IFByb21pc2U8dm9pZD5cbiAgYXN5bmMgc2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcsIGxvY2tDb25maWdPcHRzOiBPbWl0PE9iamVjdExvY2tJbmZvLCAnb2JqZWN0TG9ja0VuYWJsZWQnPikge1xuICAgIGNvbnN0IHJldGVudGlvbk1vZGVzID0gW1JFVEVOVElPTl9NT0RFUy5DT01QTElBTkNFLCBSRVRFTlRJT05fTU9ERVMuR09WRVJOQU5DRV1cbiAgICBjb25zdCB2YWxpZFVuaXRzID0gW1JFVEVOVElPTl9WQUxJRElUWV9VTklUUy5EQVlTLCBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuWUVBUlNdXG5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cblxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy5tb2RlICYmICFyZXRlbnRpb25Nb2Rlcy5pbmNsdWRlcyhsb2NrQ29uZmlnT3B0cy5tb2RlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgbG9ja0NvbmZpZ09wdHMubW9kZSBzaG91bGQgYmUgb25lIG9mICR7cmV0ZW50aW9uTW9kZXN9YClcbiAgICB9XG4gICAgaWYgKGxvY2tDb25maWdPcHRzLnVuaXQgJiYgIXZhbGlkVW5pdHMuaW5jbHVkZXMobG9ja0NvbmZpZ09wdHMudW5pdCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLnVuaXQgc2hvdWxkIGJlIG9uZSBvZiAke3ZhbGlkVW5pdHN9YClcbiAgICB9XG4gICAgaWYgKGxvY2tDb25maWdPcHRzLnZhbGlkaXR5ICYmICFpc051bWJlcihsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLnZhbGlkaXR5IHNob3VsZCBiZSBhIG51bWJlcmApXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICdvYmplY3QtbG9jaydcblxuICAgIGNvbnN0IGNvbmZpZzogT2JqZWN0TG9ja0NvbmZpZ1BhcmFtID0ge1xuICAgICAgT2JqZWN0TG9ja0VuYWJsZWQ6ICdFbmFibGVkJyxcbiAgICB9XG4gICAgY29uc3QgY29uZmlnS2V5cyA9IE9iamVjdC5rZXlzKGxvY2tDb25maWdPcHRzKVxuXG4gICAgY29uc3QgaXNBbGxLZXlzU2V0ID0gWyd1bml0JywgJ21vZGUnLCAndmFsaWRpdHknXS5ldmVyeSgobGNrKSA9PiBjb25maWdLZXlzLmluY2x1ZGVzKGxjaykpXG4gICAgLy8gQ2hlY2sgaWYga2V5cyBhcmUgcHJlc2VudCBhbmQgYWxsIGtleXMgYXJlIHByZXNlbnQuXG4gICAgaWYgKGNvbmZpZ0tleXMubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKCFpc0FsbEtleXNTZXQpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgICBgbG9ja0NvbmZpZ09wdHMubW9kZSxsb2NrQ29uZmlnT3B0cy51bml0LGxvY2tDb25maWdPcHRzLnZhbGlkaXR5IGFsbCB0aGUgcHJvcGVydGllcyBzaG91bGQgYmUgc3BlY2lmaWVkLmAsXG4gICAgICAgIClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbmZpZy5SdWxlID0ge1xuICAgICAgICAgIERlZmF1bHRSZXRlbnRpb246IHt9LFxuICAgICAgICB9XG4gICAgICAgIGlmIChsb2NrQ29uZmlnT3B0cy5tb2RlKSB7XG4gICAgICAgICAgY29uZmlnLlJ1bGUuRGVmYXVsdFJldGVudGlvbi5Nb2RlID0gbG9ja0NvbmZpZ09wdHMubW9kZVxuICAgICAgICB9XG4gICAgICAgIGlmIChsb2NrQ29uZmlnT3B0cy51bml0ID09PSBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuREFZUykge1xuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uRGF5cyA9IGxvY2tDb25maWdPcHRzLnZhbGlkaXR5XG4gICAgICAgIH0gZWxzZSBpZiAobG9ja0NvbmZpZ09wdHMudW5pdCA9PT0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTKSB7XG4gICAgICAgICAgY29uZmlnLlJ1bGUuRGVmYXVsdFJldGVudGlvbi5ZZWFycyA9IGxvY2tDb25maWdPcHRzLnZhbGlkaXR5XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24nLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcbiAgICB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGNvbmZpZylcblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXG4gIH1cblxuICBhc3luYyBnZXRCdWNrZXRWZXJzaW9uaW5nKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8QnVja2V0VmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3ZlcnNpb25pbmcnXG5cbiAgICBjb25zdCBodHRwUmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiBhd2FpdCB4bWxQYXJzZXJzLnBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyh4bWxSZXN1bHQpXG4gIH1cblxuICBhc3luYyBzZXRCdWNrZXRWZXJzaW9uaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgdmVyc2lvbkNvbmZpZzogQnVja2V0VmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIU9iamVjdC5rZXlzKHZlcnNpb25Db25maWcpLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndmVyc2lvbkNvbmZpZyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3ZlcnNpb25pbmcnXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ1ZlcnNpb25pbmdDb25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdCh2ZXJzaW9uQ29uZmlnKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZClcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2V0VGFnZ2luZyh0YWdnaW5nUGFyYW1zOiBQdXRUYWdnaW5nUGFyYW1zKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCB0YWdzLCBwdXRPcHRzIH0gPSB0YWdnaW5nUGFyYW1zXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBsZXQgcXVlcnkgPSAndGFnZ2luZydcblxuICAgIGlmIChwdXRPcHRzICYmIHB1dE9wdHM/LnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyeX0mdmVyc2lvbklkPSR7cHV0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cbiAgICBjb25zdCB0YWdzTGlzdCA9IFtdXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModGFncykpIHtcbiAgICAgIHRhZ3NMaXN0LnB1c2goeyBLZXk6IGtleSwgVmFsdWU6IHZhbHVlIH0pXG4gICAgfVxuICAgIGNvbnN0IHRhZ2dpbmdDb25maWcgPSB7XG4gICAgICBUYWdnaW5nOiB7XG4gICAgICAgIFRhZ1NldDoge1xuICAgICAgICAgIFRhZzogdGFnc0xpc3QsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH1cbiAgICBjb25zdCBoZWFkZXJzID0ge30gYXMgUmVxdWVzdEhlYWRlcnNcbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHsgaGVhZGxlc3M6IHRydWUsIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9IH0pXG4gICAgY29uc3QgcGF5bG9hZEJ1ZiA9IEJ1ZmZlci5mcm9tKGJ1aWxkZXIuYnVpbGRPYmplY3QodGFnZ2luZ0NvbmZpZykpXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7XG4gICAgICBtZXRob2QsXG4gICAgICBidWNrZXROYW1lLFxuICAgICAgcXVlcnksXG4gICAgICBoZWFkZXJzLFxuXG4gICAgICAuLi4ob2JqZWN0TmFtZSAmJiB7IG9iamVjdE5hbWU6IG9iamVjdE5hbWUgfSksXG4gICAgfVxuXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWRCdWYpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHJlcXVlc3RPcHRpb25zLCBwYXlsb2FkQnVmKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZW1vdmVUYWdnaW5nKHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcmVtb3ZlT3B0cyB9OiBSZW1vdmVUYWdnaW5nUGFyYW1zKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBsZXQgcXVlcnkgPSAndGFnZ2luZydcblxuICAgIGlmIChyZW1vdmVPcHRzICYmIE9iamVjdC5rZXlzKHJlbW92ZU9wdHMpLmxlbmd0aCAmJiByZW1vdmVPcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyeX0mdmVyc2lvbklkPSR7cmVtb3ZlT3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9XG5cbiAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgcmVxdWVzdE9wdGlvbnNbJ29iamVjdE5hbWUnXSA9IG9iamVjdE5hbWVcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHJlcXVlc3RPcHRpb25zLCAnJywgWzIwMCwgMjA0XSlcbiAgfVxuXG4gIGFzeW5jIHNldEJ1Y2tldFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nLCB0YWdzOiBUYWdzKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdCh0YWdzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndGFncyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKE9iamVjdC5rZXlzKHRhZ3MpLmxlbmd0aCA+IDEwKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdtYXhpbXVtIHRhZ3MgYWxsb3dlZCBpcyAxMFwiJylcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNldFRhZ2dpbmcoeyBidWNrZXROYW1lLCB0YWdzIH0pXG4gIH1cblxuICBhc3luYyByZW1vdmVCdWNrZXRUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGF3YWl0IHRoaXMucmVtb3ZlVGFnZ2luZyh7IGJ1Y2tldE5hbWUgfSlcbiAgfVxuXG4gIGFzeW5jIHNldE9iamVjdFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHRhZ3M6IFRhZ3MsIHB1dE9wdHM6IFRhZ2dpbmdPcHRzKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcbiAgICB9XG5cbiAgICBpZiAoIWlzT2JqZWN0KHRhZ3MpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd0YWdzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXModGFncykubGVuZ3RoID4gMTApIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ01heGltdW0gdGFncyBhbGxvd2VkIGlzIDEwXCInKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2V0VGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHRhZ3MsIHB1dE9wdHMgfSlcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZU9iamVjdFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHJlbW92ZU9wdHM6IFRhZ2dpbmdPcHRzKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcbiAgICB9XG4gICAgaWYgKHJlbW92ZU9wdHMgJiYgT2JqZWN0LmtleXMocmVtb3ZlT3B0cykubGVuZ3RoICYmICFpc09iamVjdChyZW1vdmVPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVtb3ZlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJlbW92ZVRhZ2dpbmcoeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCByZW1vdmVPcHRzIH0pXG4gIH1cblxuICBhc3luYyBzZWxlY3RPYmplY3RDb250ZW50KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgc2VsZWN0T3B0czogU2VsZWN0T3B0aW9ucyxcbiAgKTogUHJvbWlzZTxTZWxlY3RSZXN1bHRzIHwgdW5kZWZpbmVkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cykpIHtcbiAgICAgIGlmICghaXNTdHJpbmcoc2VsZWN0T3B0cy5leHByZXNzaW9uKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzcWxFeHByZXNzaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgICAgfVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgIGlmICghaXNPYmplY3Qoc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignaW5wdXRTZXJpYWxpemF0aW9uIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdpbnB1dFNlcmlhbGl6YXRpb24gaXMgcmVxdWlyZWQnKVxuICAgICAgfVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uKSkge1xuICAgICAgICBpZiAoIWlzT2JqZWN0KHNlbGVjdE9wdHMub3V0cHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvdXRwdXRTZXJpYWxpemF0aW9uIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvdXRwdXRTZXJpYWxpemF0aW9uIGlzIHJlcXVpcmVkJylcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsaWQgc2VsZWN0IGNvbmZpZ3VyYXRpb24gaXMgcmVxdWlyZWQnKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQT1NUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gYHNlbGVjdCZzZWxlY3QtdHlwZT0yYFxuXG4gICAgY29uc3QgY29uZmlnOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdID0gW1xuICAgICAge1xuICAgICAgICBFeHByZXNzaW9uOiBzZWxlY3RPcHRzLmV4cHJlc3Npb24sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBFeHByZXNzaW9uVHlwZTogc2VsZWN0T3B0cy5leHByZXNzaW9uVHlwZSB8fCAnU1FMJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIElucHV0U2VyaWFsaXphdGlvbjogW3NlbGVjdE9wdHMuaW5wdXRTZXJpYWxpemF0aW9uXSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIE91dHB1dFNlcmlhbGl6YXRpb246IFtzZWxlY3RPcHRzLm91dHB1dFNlcmlhbGl6YXRpb25dLFxuICAgICAgfSxcbiAgICBdXG5cbiAgICAvLyBPcHRpb25hbFxuICAgIGlmIChzZWxlY3RPcHRzLnJlcXVlc3RQcm9ncmVzcykge1xuICAgICAgY29uZmlnLnB1c2goeyBSZXF1ZXN0UHJvZ3Jlc3M6IHNlbGVjdE9wdHM/LnJlcXVlc3RQcm9ncmVzcyB9KVxuICAgIH1cbiAgICAvLyBPcHRpb25hbFxuICAgIGlmIChzZWxlY3RPcHRzLnNjYW5SYW5nZSkge1xuICAgICAgY29uZmlnLnB1c2goeyBTY2FuUmFuZ2U6IHNlbGVjdE9wdHMuc2NhblJhbmdlIH0pXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ1NlbGVjdE9iamVjdENvbnRlbnRSZXF1ZXN0JyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQpXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc0J1ZmZlcihyZXMpXG4gICAgcmV0dXJuIHBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlKGJvZHkpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFwcGx5QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWU6IHN0cmluZywgcG9saWN5Q29uZmlnOiBMaWZlQ3ljbGVDb25maWdQYXJhbSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdMaWZlY3ljbGVDb25maWd1cmF0aW9uJyxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChwb2xpY3lDb25maWcpXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjA0XSlcbiAgfVxuXG4gIGFzeW5jIHNldEJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lOiBzdHJpbmcsIGxpZmVDeWNsZUNvbmZpZzogTGlmZUN5Y2xlQ29uZmlnUGFyYW0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoXy5pc0VtcHR5KGxpZmVDeWNsZUNvbmZpZykpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlQnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWUpXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuYXBwbHlCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSwgbGlmZUN5Y2xlQ29uZmlnKVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGdldEJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPExpZmVjeWNsZUNvbmZpZyB8IG51bGw+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xpZmVjeWNsZSdcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUxpZmVjeWNsZUNvbmZpZyhib2R5KVxuICB9XG5cbiAgYXN5bmMgc2V0QnVja2V0RW5jcnlwdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIGVuY3J5cHRpb25Db25maWc/OiBFbmNyeXB0aW9uQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFfLmlzRW1wdHkoZW5jcnlwdGlvbkNvbmZpZykgJiYgZW5jcnlwdGlvbkNvbmZpZy5SdWxlLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0ludmFsaWQgUnVsZSBsZW5ndGguIE9ubHkgb25lIHJ1bGUgaXMgYWxsb3dlZC46ICcgKyBlbmNyeXB0aW9uQ29uZmlnLlJ1bGUpXG4gICAgfVxuXG4gICAgbGV0IGVuY3J5cHRpb25PYmogPSBlbmNyeXB0aW9uQ29uZmlnXG4gICAgaWYgKF8uaXNFbXB0eShlbmNyeXB0aW9uQ29uZmlnKSkge1xuICAgICAgZW5jcnlwdGlvbk9iaiA9IHtcbiAgICAgICAgLy8gRGVmYXVsdCBNaW5JTyBTZXJ2ZXIgU3VwcG9ydGVkIFJ1bGVcbiAgICAgICAgUnVsZTogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIEFwcGx5U2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgU1NFQWxnb3JpdGhtOiAnQUVTMjU2JyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2VuY3J5cHRpb24nXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ1NlcnZlclNpZGVFbmNyeXB0aW9uQ29uZmlndXJhdGlvbicsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoZW5jcnlwdGlvbk9iailcblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXG4gIH1cblxuICBhc3luYyBnZXRCdWNrZXRFbmNyeXB0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnZW5jcnlwdGlvbidcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUJ1Y2tldEVuY3J5cHRpb25Db25maWcoYm9keSlcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldEVuY3J5cHRpb24oYnVja2V0TmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9ICdlbmNyeXB0aW9uJ1xuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDRdKVxuICB9XG5cbiAgYXN5bmMgZ2V0T2JqZWN0UmV0ZW50aW9uKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZ2V0T3B0cz86IEdldE9iamVjdFJldGVudGlvbk9wdHMsXG4gICk6IFByb21pc2U8T2JqZWN0UmV0ZW50aW9uSW5mbyB8IG51bGwgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoZ2V0T3B0cyAmJiAhaXNPYmplY3QoZ2V0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2dldE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfSBlbHNlIGlmIChnZXRPcHRzPy52ZXJzaW9uSWQgJiYgIWlzU3RyaW5nKGdldE9wdHMudmVyc2lvbklkKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndmVyc2lvbklkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3JldGVudGlvbidcbiAgICBpZiAoZ2V0T3B0cz8udmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSArPSBgJnZlcnNpb25JZD0ke2dldE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnKGJvZHkpXG4gIH1cblxuICBhc3luYyByZW1vdmVPYmplY3RzKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0c0xpc3Q6IFJlbW92ZU9iamVjdHNQYXJhbSk6IFByb21pc2U8UmVtb3ZlT2JqZWN0c1Jlc3BvbnNlW10+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkob2JqZWN0c0xpc3QpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdvYmplY3RzTGlzdCBzaG91bGQgYmUgYSBsaXN0JylcbiAgICB9XG5cbiAgICBjb25zdCBydW5EZWxldGVPYmplY3RzID0gYXN5bmMgKGJhdGNoOiBSZW1vdmVPYmplY3RzUGFyYW0pOiBQcm9taXNlPFJlbW92ZU9iamVjdHNSZXNwb25zZVtdPiA9PiB7XG4gICAgICBjb25zdCBkZWxPYmplY3RzOiBSZW1vdmVPYmplY3RzUmVxdWVzdEVudHJ5W10gPSBiYXRjaC5tYXAoKHZhbHVlKSA9PiB7XG4gICAgICAgIHJldHVybiBpc09iamVjdCh2YWx1ZSkgPyB7IEtleTogdmFsdWUubmFtZSwgVmVyc2lvbklkOiB2YWx1ZS52ZXJzaW9uSWQgfSA6IHsgS2V5OiB2YWx1ZSB9XG4gICAgICB9KVxuXG4gICAgICBjb25zdCByZW1PYmplY3RzID0geyBEZWxldGU6IHsgUXVpZXQ6IHRydWUsIE9iamVjdDogZGVsT2JqZWN0cyB9IH1cbiAgICAgIGNvbnN0IHBheWxvYWQgPSBCdWZmZXIuZnJvbShuZXcgeG1sMmpzLkJ1aWxkZXIoeyBoZWFkbGVzczogdHJ1ZSB9KS5idWlsZE9iamVjdChyZW1PYmplY3RzKSlcbiAgICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0geyAnQ29udGVudC1NRDUnOiB0b01kNShwYXlsb2FkKSB9XG5cbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZDogJ1BPU1QnLCBidWNrZXROYW1lLCBxdWVyeTogJ2RlbGV0ZScsIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgICAgcmV0dXJuIHhtbFBhcnNlcnMucmVtb3ZlT2JqZWN0c1BhcnNlcihib2R5KVxuICAgIH1cblxuICAgIGNvbnN0IG1heEVudHJpZXMgPSAxMDAwIC8vIG1heCBlbnRyaWVzIGFjY2VwdGVkIGluIHNlcnZlciBmb3IgRGVsZXRlTXVsdGlwbGVPYmplY3RzIEFQSS5cbiAgICAvLyBDbGllbnQgc2lkZSBiYXRjaGluZ1xuICAgIGNvbnN0IGJhdGNoZXMgPSBbXVxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgb2JqZWN0c0xpc3QubGVuZ3RoOyBpICs9IG1heEVudHJpZXMpIHtcbiAgICAgIGJhdGNoZXMucHVzaChvYmplY3RzTGlzdC5zbGljZShpLCBpICsgbWF4RW50cmllcykpXG4gICAgfVxuXG4gICAgY29uc3QgYmF0Y2hSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoYmF0Y2hlcy5tYXAocnVuRGVsZXRlT2JqZWN0cykpXG4gICAgcmV0dXJuIGJhdGNoUmVzdWx0cy5mbGF0KClcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUluY29tcGxldGVVcGxvYWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLklzVmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBjb25zdCByZW1vdmVVcGxvYWRJZCA9IGF3YWl0IHRoaXMuZmluZFVwbG9hZElkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUpXG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9IGB1cGxvYWRJZD0ke3JlbW92ZVVwbG9hZElkfWBcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCAnJywgWzIwNF0pXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvcHlPYmplY3RWMShcbiAgICB0YXJnZXRCdWNrZXROYW1lOiBzdHJpbmcsXG4gICAgdGFyZ2V0T2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgY29uZGl0aW9ucz86IG51bGwgfCBDb3B5Q29uZGl0aW9ucyxcbiAgKSB7XG4gICAgaWYgKHR5cGVvZiBjb25kaXRpb25zID09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNvbmRpdGlvbnMgPSBudWxsXG4gICAgfVxuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZSh0YXJnZXRCdWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgdGFyZ2V0QnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZSh0YXJnZXRPYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke3RhcmdldE9iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUgPT09ICcnKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRQcmVmaXhFcnJvcihgRW1wdHkgc291cmNlIHByZWZpeGApXG4gICAgfVxuXG4gICAgaWYgKGNvbmRpdGlvbnMgIT0gbnVsbCAmJiAhKGNvbmRpdGlvbnMgaW5zdGFuY2VvZiBDb3B5Q29uZGl0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NvbmRpdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJDb3B5Q29uZGl0aW9uc1wiJylcbiAgICB9XG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UnXSA9IHVyaVJlc291cmNlRXNjYXBlKHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lKVxuXG4gICAgaWYgKGNvbmRpdGlvbnMpIHtcbiAgICAgIGlmIChjb25kaXRpb25zLm1vZGlmaWVkICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi1tb2RpZmllZC1zaW5jZSddID0gY29uZGl0aW9ucy5tb2RpZmllZFxuICAgICAgfVxuICAgICAgaWYgKGNvbmRpdGlvbnMudW5tb2RpZmllZCAhPT0gJycpIHtcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtdW5tb2RpZmllZC1zaW5jZSddID0gY29uZGl0aW9ucy51bm1vZGlmaWVkXG4gICAgICB9XG4gICAgICBpZiAoY29uZGl0aW9ucy5tYXRjaEVUYWcgIT09ICcnKSB7XG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLW1hdGNoJ10gPSBjb25kaXRpb25zLm1hdGNoRVRhZ1xuICAgICAgfVxuICAgICAgaWYgKGNvbmRpdGlvbnMubWF0Y2hFVGFnRXhjZXB0ICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi1ub25lLW1hdGNoJ10gPSBjb25kaXRpb25zLm1hdGNoRVRhZ0V4Y2VwdFxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoe1xuICAgICAgbWV0aG9kLFxuICAgICAgYnVja2V0TmFtZTogdGFyZ2V0QnVja2V0TmFtZSxcbiAgICAgIG9iamVjdE5hbWU6IHRhcmdldE9iamVjdE5hbWUsXG4gICAgICBoZWFkZXJzLFxuICAgIH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VDb3B5T2JqZWN0KGJvZHkpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvcHlPYmplY3RWMihcbiAgICBzb3VyY2VDb25maWc6IENvcHlTb3VyY2VPcHRpb25zLFxuICAgIGRlc3RDb25maWc6IENvcHlEZXN0aW5hdGlvbk9wdGlvbnMsXG4gICk6IFByb21pc2U8Q29weU9iamVjdFJlc3VsdFYyPiB7XG4gICAgaWYgKCEoc291cmNlQ29uZmlnIGluc3RhbmNlb2YgQ29weVNvdXJjZU9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdzb3VyY2VDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weVNvdXJjZU9wdGlvbnMgJylcbiAgICB9XG4gICAgaWYgKCEoZGVzdENvbmZpZyBpbnN0YW5jZW9mIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdkZXN0Q29uZmlnIHNob3VsZCBvZiB0eXBlIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMgJylcbiAgICB9XG4gICAgaWYgKCFkZXN0Q29uZmlnLnZhbGlkYXRlKCkpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdCgpXG4gICAgfVxuICAgIGlmICghZGVzdENvbmZpZy52YWxpZGF0ZSgpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoKVxuICAgIH1cblxuICAgIGNvbnN0IGhlYWRlcnMgPSBPYmplY3QuYXNzaWduKHt9LCBzb3VyY2VDb25maWcuZ2V0SGVhZGVycygpLCBkZXN0Q29uZmlnLmdldEhlYWRlcnMoKSlcblxuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBkZXN0Q29uZmlnLkJ1Y2tldFxuICAgIGNvbnN0IG9iamVjdE5hbWUgPSBkZXN0Q29uZmlnLk9iamVjdFxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycyB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIGNvbnN0IGNvcHlSZXMgPSB4bWxQYXJzZXJzLnBhcnNlQ29weU9iamVjdChib2R5KVxuICAgIGNvbnN0IHJlc0hlYWRlcnM6IEluY29taW5nSHR0cEhlYWRlcnMgPSByZXMuaGVhZGVyc1xuXG4gICAgY29uc3Qgc2l6ZUhlYWRlclZhbHVlID0gcmVzSGVhZGVycyAmJiByZXNIZWFkZXJzWydjb250ZW50LWxlbmd0aCddXG4gICAgY29uc3Qgc2l6ZSA9IHR5cGVvZiBzaXplSGVhZGVyVmFsdWUgPT09ICdudW1iZXInID8gc2l6ZUhlYWRlclZhbHVlIDogdW5kZWZpbmVkXG5cbiAgICByZXR1cm4ge1xuICAgICAgQnVja2V0OiBkZXN0Q29uZmlnLkJ1Y2tldCxcbiAgICAgIEtleTogZGVzdENvbmZpZy5PYmplY3QsXG4gICAgICBMYXN0TW9kaWZpZWQ6IGNvcHlSZXMubGFzdE1vZGlmaWVkLFxuICAgICAgTWV0YURhdGE6IGV4dHJhY3RNZXRhZGF0YShyZXNIZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICAgIFZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlc0hlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgICAgU291cmNlVmVyc2lvbklkOiBnZXRTb3VyY2VWZXJzaW9uSWQocmVzSGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgICBFdGFnOiBzYW5pdGl6ZUVUYWcocmVzSGVhZGVycy5ldGFnKSxcbiAgICAgIFNpemU6IHNpemUsXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY29weU9iamVjdChzb3VyY2U6IENvcHlTb3VyY2VPcHRpb25zLCBkZXN0OiBDb3B5RGVzdGluYXRpb25PcHRpb25zKTogUHJvbWlzZTxDb3B5T2JqZWN0UmVzdWx0PlxuICBhc3luYyBjb3B5T2JqZWN0KFxuICAgIHRhcmdldEJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICB0YXJnZXRPYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBjb25kaXRpb25zPzogQ29weUNvbmRpdGlvbnMsXG4gICk6IFByb21pc2U8Q29weU9iamVjdFJlc3VsdD5cbiAgYXN5bmMgY29weU9iamVjdCguLi5hbGxBcmdzOiBDb3B5T2JqZWN0UGFyYW1zKTogUHJvbWlzZTxDb3B5T2JqZWN0UmVzdWx0PiB7XG4gICAgaWYgKHR5cGVvZiBhbGxBcmdzWzBdID09PSAnc3RyaW5nJykge1xuICAgICAgY29uc3QgW3RhcmdldEJ1Y2tldE5hbWUsIHRhcmdldE9iamVjdE5hbWUsIHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lLCBjb25kaXRpb25zXSA9IGFsbEFyZ3MgYXMgW1xuICAgICAgICBzdHJpbmcsXG4gICAgICAgIHN0cmluZyxcbiAgICAgICAgc3RyaW5nLFxuICAgICAgICBDb3B5Q29uZGl0aW9ucz8sXG4gICAgICBdXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb3B5T2JqZWN0VjEodGFyZ2V0QnVja2V0TmFtZSwgdGFyZ2V0T2JqZWN0TmFtZSwgc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUsIGNvbmRpdGlvbnMpXG4gICAgfVxuICAgIGNvbnN0IFtzb3VyY2UsIGRlc3RdID0gYWxsQXJncyBhcyBbQ29weVNvdXJjZU9wdGlvbnMsIENvcHlEZXN0aW5hdGlvbk9wdGlvbnNdXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29weU9iamVjdFYyKHNvdXJjZSwgZGVzdClcbiAgfVxuXG4gIGFzeW5jIHVwbG9hZFBhcnQocGFydENvbmZpZzoge1xuICAgIGJ1Y2tldE5hbWU6IHN0cmluZ1xuICAgIG9iamVjdE5hbWU6IHN0cmluZ1xuICAgIHVwbG9hZElEOiBzdHJpbmdcbiAgICBwYXJ0TnVtYmVyOiBudW1iZXJcbiAgICBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVyc1xuICB9KSB7XG4gICAgY29uc3QgeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCB1cGxvYWRJRCwgcGFydE51bWJlciwgaGVhZGVycyB9ID0gcGFydENvbmZpZ1xuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VwbG9hZElEfSZwYXJ0TnVtYmVyPSR7cGFydE51bWJlcn1gXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZTogb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfVxuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHJlcXVlc3RPcHRpb25zKVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIGNvbnN0IHBhcnRSZXMgPSB1cGxvYWRQYXJ0UGFyc2VyKGJvZHkpXG5cbiAgICByZXR1cm4ge1xuICAgICAgZXRhZzogc2FuaXRpemVFVGFnKHBhcnRSZXMuRVRhZyksXG4gICAgICBrZXk6IG9iamVjdE5hbWUsXG4gICAgICBwYXJ0OiBwYXJ0TnVtYmVyLFxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGNvbXBvc2VPYmplY3QoXG4gICAgZGVzdE9iakNvbmZpZzogQ29weURlc3RpbmF0aW9uT3B0aW9ucyxcbiAgICBzb3VyY2VPYmpMaXN0OiBDb3B5U291cmNlT3B0aW9uc1tdLFxuICApOiBQcm9taXNlPGJvb2xlYW4gfCB7IGV0YWc6IHN0cmluZzsgdmVyc2lvbklkOiBzdHJpbmcgfCBudWxsIH0gfCBQcm9taXNlPHZvaWQ+IHwgQ29weU9iamVjdFJlc3VsdD4ge1xuICAgIGNvbnN0IHNvdXJjZUZpbGVzTGVuZ3RoID0gc291cmNlT2JqTGlzdC5sZW5ndGhcblxuICAgIGlmICghQXJyYXkuaXNBcnJheShzb3VyY2VPYmpMaXN0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc291cmNlQ29uZmlnIHNob3VsZCBhbiBhcnJheSBvZiBDb3B5U291cmNlT3B0aW9ucyAnKVxuICAgIH1cbiAgICBpZiAoIShkZXN0T2JqQ29uZmlnIGluc3RhbmNlb2YgQ29weURlc3RpbmF0aW9uT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2Rlc3RDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weURlc3RpbmF0aW9uT3B0aW9ucyAnKVxuICAgIH1cblxuICAgIGlmIChzb3VyY2VGaWxlc0xlbmd0aCA8IDEgfHwgc291cmNlRmlsZXNMZW5ndGggPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgYFwiVGhlcmUgbXVzdCBiZSBhcyBsZWFzdCBvbmUgYW5kIHVwIHRvICR7UEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlR9IHNvdXJjZSBvYmplY3RzLmAsXG4gICAgICApXG4gICAgfVxuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzb3VyY2VGaWxlc0xlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBzT2JqID0gc291cmNlT2JqTGlzdFtpXSBhcyBDb3B5U291cmNlT3B0aW9uc1xuICAgICAgaWYgKCFzT2JqLnZhbGlkYXRlKCkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCEoZGVzdE9iakNvbmZpZyBhcyBDb3B5RGVzdGluYXRpb25PcHRpb25zKS52YWxpZGF0ZSgpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBjb25zdCBnZXRTdGF0T3B0aW9ucyA9IChzcmNDb25maWc6IENvcHlTb3VyY2VPcHRpb25zKSA9PiB7XG4gICAgICBsZXQgc3RhdE9wdHMgPSB7fVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc3JjQ29uZmlnLlZlcnNpb25JRCkpIHtcbiAgICAgICAgc3RhdE9wdHMgPSB7XG4gICAgICAgICAgdmVyc2lvbklkOiBzcmNDb25maWcuVmVyc2lvbklELFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gc3RhdE9wdHNcbiAgICB9XG4gICAgY29uc3Qgc3JjT2JqZWN0U2l6ZXM6IG51bWJlcltdID0gW11cbiAgICBsZXQgdG90YWxTaXplID0gMFxuICAgIGxldCB0b3RhbFBhcnRzID0gMFxuXG4gICAgY29uc3Qgc291cmNlT2JqU3RhdHMgPSBzb3VyY2VPYmpMaXN0Lm1hcCgoc3JjSXRlbSkgPT5cbiAgICAgIHRoaXMuc3RhdE9iamVjdChzcmNJdGVtLkJ1Y2tldCwgc3JjSXRlbS5PYmplY3QsIGdldFN0YXRPcHRpb25zKHNyY0l0ZW0pKSxcbiAgICApXG5cbiAgICBjb25zdCBzcmNPYmplY3RJbmZvcyA9IGF3YWl0IFByb21pc2UuYWxsKHNvdXJjZU9ialN0YXRzKVxuXG4gICAgY29uc3QgdmFsaWRhdGVkU3RhdHMgPSBzcmNPYmplY3RJbmZvcy5tYXAoKHJlc0l0ZW1TdGF0LCBpbmRleCkgPT4ge1xuICAgICAgY29uc3Qgc3JjQ29uZmlnOiBDb3B5U291cmNlT3B0aW9ucyB8IHVuZGVmaW5lZCA9IHNvdXJjZU9iakxpc3RbaW5kZXhdXG5cbiAgICAgIGxldCBzcmNDb3B5U2l6ZSA9IHJlc0l0ZW1TdGF0LnNpemVcbiAgICAgIC8vIENoZWNrIGlmIGEgc2VnbWVudCBpcyBzcGVjaWZpZWQsIGFuZCBpZiBzbywgaXMgdGhlXG4gICAgICAvLyBzZWdtZW50IHdpdGhpbiBvYmplY3QgYm91bmRzP1xuICAgICAgaWYgKHNyY0NvbmZpZyAmJiBzcmNDb25maWcuTWF0Y2hSYW5nZSkge1xuICAgICAgICAvLyBTaW5jZSByYW5nZSBpcyBzcGVjaWZpZWQsXG4gICAgICAgIC8vICAgIDAgPD0gc3JjLnNyY1N0YXJ0IDw9IHNyYy5zcmNFbmRcbiAgICAgICAgLy8gc28gb25seSBpbnZhbGlkIGNhc2UgdG8gY2hlY2sgaXM6XG4gICAgICAgIGNvbnN0IHNyY1N0YXJ0ID0gc3JjQ29uZmlnLlN0YXJ0XG4gICAgICAgIGNvbnN0IHNyY0VuZCA9IHNyY0NvbmZpZy5FbmRcbiAgICAgICAgaWYgKHNyY0VuZCA+PSBzcmNDb3B5U2l6ZSB8fCBzcmNTdGFydCA8IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgICAgYENvcHlTcmNPcHRpb25zICR7aW5kZXh9IGhhcyBpbnZhbGlkIHNlZ21lbnQtdG8tY29weSBbJHtzcmNTdGFydH0sICR7c3JjRW5kfV0gKHNpemUgaXMgJHtzcmNDb3B5U2l6ZX0pYCxcbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgICAgc3JjQ29weVNpemUgPSBzcmNFbmQgLSBzcmNTdGFydCArIDFcbiAgICAgIH1cblxuICAgICAgLy8gT25seSB0aGUgbGFzdCBzb3VyY2UgbWF5IGJlIGxlc3MgdGhhbiBgYWJzTWluUGFydFNpemVgXG4gICAgICBpZiAoc3JjQ29weVNpemUgPCBQQVJUX0NPTlNUUkFJTlRTLkFCU19NSU5fUEFSVF9TSVpFICYmIGluZGV4IDwgc291cmNlRmlsZXNMZW5ndGggLSAxKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgYENvcHlTcmNPcHRpb25zICR7aW5kZXh9IGlzIHRvbyBzbWFsbCAoJHtzcmNDb3B5U2l6ZX0pIGFuZCBpdCBpcyBub3QgdGhlIGxhc3QgcGFydC5gLFxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIC8vIElzIGRhdGEgdG8gY29weSB0b28gbGFyZ2U/XG4gICAgICB0b3RhbFNpemUgKz0gc3JjQ29weVNpemVcbiAgICAgIGlmICh0b3RhbFNpemUgPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYENhbm5vdCBjb21wb3NlIGFuIG9iamVjdCBvZiBzaXplICR7dG90YWxTaXplfSAoPiA1VGlCKWApXG4gICAgICB9XG5cbiAgICAgIC8vIHJlY29yZCBzb3VyY2Ugc2l6ZVxuICAgICAgc3JjT2JqZWN0U2l6ZXNbaW5kZXhdID0gc3JjQ29weVNpemVcblxuICAgICAgLy8gY2FsY3VsYXRlIHBhcnRzIG5lZWRlZCBmb3IgY3VycmVudCBzb3VyY2VcbiAgICAgIHRvdGFsUGFydHMgKz0gcGFydHNSZXF1aXJlZChzcmNDb3B5U2l6ZSlcbiAgICAgIC8vIERvIHdlIG5lZWQgbW9yZSBwYXJ0cyB0aGFuIHdlIGFyZSBhbGxvd2VkP1xuICAgICAgaWYgKHRvdGFsUGFydHMgPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgIGBZb3VyIHByb3Bvc2VkIGNvbXBvc2Ugb2JqZWN0IHJlcXVpcmVzIG1vcmUgdGhhbiAke1BBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UfSBwYXJ0c2AsXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc0l0ZW1TdGF0XG4gICAgfSlcblxuICAgIGlmICgodG90YWxQYXJ0cyA9PT0gMSAmJiB0b3RhbFNpemUgPD0gUEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVF9TSVpFKSB8fCB0b3RhbFNpemUgPT09IDApIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvcHlPYmplY3Qoc291cmNlT2JqTGlzdFswXSBhcyBDb3B5U291cmNlT3B0aW9ucywgZGVzdE9iakNvbmZpZykgLy8gdXNlIGNvcHlPYmplY3RWMlxuICAgIH1cblxuICAgIC8vIHByZXNlcnZlIGV0YWcgdG8gYXZvaWQgbW9kaWZpY2F0aW9uIG9mIG9iamVjdCB3aGlsZSBjb3B5aW5nLlxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc291cmNlRmlsZXNMZW5ndGg7IGkrKykge1xuICAgICAgOyhzb3VyY2VPYmpMaXN0W2ldIGFzIENvcHlTb3VyY2VPcHRpb25zKS5NYXRjaEVUYWcgPSAodmFsaWRhdGVkU3RhdHNbaV0gYXMgQnVja2V0SXRlbVN0YXQpLmV0YWdcbiAgICB9XG5cbiAgICBjb25zdCBzcGxpdFBhcnRTaXplTGlzdCA9IHZhbGlkYXRlZFN0YXRzLm1hcCgocmVzSXRlbVN0YXQsIGlkeCkgPT4ge1xuICAgICAgcmV0dXJuIGNhbGN1bGF0ZUV2ZW5TcGxpdHMoc3JjT2JqZWN0U2l6ZXNbaWR4XSBhcyBudW1iZXIsIHNvdXJjZU9iakxpc3RbaWR4XSBhcyBDb3B5U291cmNlT3B0aW9ucylcbiAgICB9KVxuXG4gICAgY29uc3QgZ2V0VXBsb2FkUGFydENvbmZpZ0xpc3QgPSAodXBsb2FkSWQ6IHN0cmluZykgPT4ge1xuICAgICAgY29uc3QgdXBsb2FkUGFydENvbmZpZ0xpc3Q6IFVwbG9hZFBhcnRDb25maWdbXSA9IFtdXG5cbiAgICAgIHNwbGl0UGFydFNpemVMaXN0LmZvckVhY2goKHNwbGl0U2l6ZSwgc3BsaXRJbmRleDogbnVtYmVyKSA9PiB7XG4gICAgICAgIGlmIChzcGxpdFNpemUpIHtcbiAgICAgICAgICBjb25zdCB7IHN0YXJ0SW5kZXg6IHN0YXJ0SWR4LCBlbmRJbmRleDogZW5kSWR4LCBvYmpJbmZvOiBvYmpDb25maWcgfSA9IHNwbGl0U2l6ZVxuXG4gICAgICAgICAgY29uc3QgcGFydEluZGV4ID0gc3BsaXRJbmRleCArIDEgLy8gcGFydCBpbmRleCBzdGFydHMgZnJvbSAxLlxuICAgICAgICAgIGNvbnN0IHRvdGFsVXBsb2FkcyA9IEFycmF5LmZyb20oc3RhcnRJZHgpXG5cbiAgICAgICAgICBjb25zdCBoZWFkZXJzID0gKHNvdXJjZU9iakxpc3Rbc3BsaXRJbmRleF0gYXMgQ29weVNvdXJjZU9wdGlvbnMpLmdldEhlYWRlcnMoKVxuXG4gICAgICAgICAgdG90YWxVcGxvYWRzLmZvckVhY2goKHNwbGl0U3RhcnQsIHVwbGRDdHJJZHgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNwbGl0RW5kID0gZW5kSWR4W3VwbGRDdHJJZHhdXG5cbiAgICAgICAgICAgIGNvbnN0IHNvdXJjZU9iaiA9IGAke29iakNvbmZpZy5CdWNrZXR9LyR7b2JqQ29uZmlnLk9iamVjdH1gXG4gICAgICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZSddID0gYCR7c291cmNlT2JqfWBcbiAgICAgICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLXJhbmdlJ10gPSBgYnl0ZXM9JHtzcGxpdFN0YXJ0fS0ke3NwbGl0RW5kfWBcblxuICAgICAgICAgICAgY29uc3QgdXBsb2FkUGFydENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgYnVja2V0TmFtZTogZGVzdE9iakNvbmZpZy5CdWNrZXQsXG4gICAgICAgICAgICAgIG9iamVjdE5hbWU6IGRlc3RPYmpDb25maWcuT2JqZWN0LFxuICAgICAgICAgICAgICB1cGxvYWRJRDogdXBsb2FkSWQsXG4gICAgICAgICAgICAgIHBhcnROdW1iZXI6IHBhcnRJbmRleCxcbiAgICAgICAgICAgICAgaGVhZGVyczogaGVhZGVycyxcbiAgICAgICAgICAgICAgc291cmNlT2JqOiBzb3VyY2VPYmosXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHVwbG9hZFBhcnRDb25maWdMaXN0LnB1c2godXBsb2FkUGFydENvbmZpZylcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gdXBsb2FkUGFydENvbmZpZ0xpc3RcbiAgICB9XG5cbiAgICBjb25zdCB1cGxvYWRBbGxQYXJ0cyA9IGFzeW5jICh1cGxvYWRMaXN0OiBVcGxvYWRQYXJ0Q29uZmlnW10pID0+IHtcbiAgICAgIGNvbnN0IHBhcnRVcGxvYWRzID0gdXBsb2FkTGlzdC5tYXAoYXN5bmMgKGl0ZW0pID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMudXBsb2FkUGFydChpdGVtKVxuICAgICAgfSlcbiAgICAgIC8vIFByb2Nlc3MgcmVzdWx0cyBoZXJlIGlmIG5lZWRlZFxuICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKHBhcnRVcGxvYWRzKVxuICAgIH1cblxuICAgIGNvbnN0IHBlcmZvcm1VcGxvYWRQYXJ0cyA9IGFzeW5jICh1cGxvYWRJZDogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCB1cGxvYWRMaXN0ID0gZ2V0VXBsb2FkUGFydENvbmZpZ0xpc3QodXBsb2FkSWQpXG4gICAgICBjb25zdCBwYXJ0c1JlcyA9IGF3YWl0IHVwbG9hZEFsbFBhcnRzKHVwbG9hZExpc3QpXG4gICAgICByZXR1cm4gcGFydHNSZXMubWFwKChwYXJ0Q29weSkgPT4gKHsgZXRhZzogcGFydENvcHkuZXRhZywgcGFydDogcGFydENvcHkucGFydCB9KSlcbiAgICB9XG5cbiAgICBjb25zdCBuZXdVcGxvYWRIZWFkZXJzID0gZGVzdE9iakNvbmZpZy5nZXRIZWFkZXJzKClcblxuICAgIGNvbnN0IHVwbG9hZElkID0gYXdhaXQgdGhpcy5pbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZChkZXN0T2JqQ29uZmlnLkJ1Y2tldCwgZGVzdE9iakNvbmZpZy5PYmplY3QsIG5ld1VwbG9hZEhlYWRlcnMpXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnRzRG9uZSA9IGF3YWl0IHBlcmZvcm1VcGxvYWRQYXJ0cyh1cGxvYWRJZClcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkKGRlc3RPYmpDb25maWcuQnVja2V0LCBkZXN0T2JqQ29uZmlnLk9iamVjdCwgdXBsb2FkSWQsIHBhcnRzRG9uZSlcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmFib3J0TXVsdGlwYXJ0VXBsb2FkKGRlc3RPYmpDb25maWcuQnVja2V0LCBkZXN0T2JqQ29uZmlnLk9iamVjdCwgdXBsb2FkSWQpXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcHJlc2lnbmVkVXJsKFxuICAgIG1ldGhvZDogc3RyaW5nLFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZXhwaXJlcz86IG51bWJlciB8IFByZVNpZ25SZXF1ZXN0UGFyYW1zIHwgdW5kZWZpbmVkLFxuICAgIHJlcVBhcmFtcz86IFByZVNpZ25SZXF1ZXN0UGFyYW1zIHwgRGF0ZSxcbiAgICByZXF1ZXN0RGF0ZT86IERhdGUsXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKHRoaXMuYW5vbnltb3VzKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkFub255bW91c1JlcXVlc3RFcnJvcihgUHJlc2lnbmVkICR7bWV0aG9kfSB1cmwgY2Fubm90IGJlIGdlbmVyYXRlZCBmb3IgYW5vbnltb3VzIHJlcXVlc3RzYClcbiAgICB9XG5cbiAgICBpZiAoIWV4cGlyZXMpIHtcbiAgICAgIGV4cGlyZXMgPSBQUkVTSUdOX0VYUElSWV9EQVlTX01BWFxuICAgIH1cbiAgICBpZiAoIXJlcVBhcmFtcykge1xuICAgICAgcmVxUGFyYW1zID0ge31cbiAgICB9XG4gICAgaWYgKCFyZXF1ZXN0RGF0ZSkge1xuICAgICAgcmVxdWVzdERhdGUgPSBuZXcgRGF0ZSgpXG4gICAgfVxuXG4gICAgLy8gVHlwZSBhc3NlcnRpb25zXG4gICAgaWYgKGV4cGlyZXMgJiYgdHlwZW9mIGV4cGlyZXMgIT09ICdudW1iZXInKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdleHBpcmVzIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAocmVxUGFyYW1zICYmIHR5cGVvZiByZXFQYXJhbXMgIT09ICdvYmplY3QnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXFQYXJhbXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICgocmVxdWVzdERhdGUgJiYgIShyZXF1ZXN0RGF0ZSBpbnN0YW5jZW9mIERhdGUpKSB8fCAocmVxdWVzdERhdGUgJiYgaXNOYU4ocmVxdWVzdERhdGU/LmdldFRpbWUoKSkpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXF1ZXN0RGF0ZSBzaG91bGQgYmUgb2YgdHlwZSBcIkRhdGVcIiBhbmQgdmFsaWQnKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5ID0gcmVxUGFyYW1zID8gcXMuc3RyaW5naWZ5KHJlcVBhcmFtcykgOiB1bmRlZmluZWRcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZWdpb24gPSBhd2FpdCB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWUpXG4gICAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcbiAgICAgIGNvbnN0IHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKHsgbWV0aG9kLCByZWdpb24sIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0pXG5cbiAgICAgIHJldHVybiBwcmVzaWduU2lnbmF0dXJlVjQoXG4gICAgICAgIHJlcU9wdGlvbnMsXG4gICAgICAgIHRoaXMuYWNjZXNzS2V5LFxuICAgICAgICB0aGlzLnNlY3JldEtleSxcbiAgICAgICAgdGhpcy5zZXNzaW9uVG9rZW4sXG4gICAgICAgIHJlZ2lvbixcbiAgICAgICAgcmVxdWVzdERhdGUsXG4gICAgICAgIGV4cGlyZXMsXG4gICAgICApXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBVbmFibGUgdG8gZ2V0IGJ1Y2tldCByZWdpb24gZm9yICAke2J1Y2tldE5hbWV9LmApXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcHJlc2lnbmVkR2V0T2JqZWN0KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZXhwaXJlcz86IG51bWJlcixcbiAgICByZXNwSGVhZGVycz86IFByZVNpZ25SZXF1ZXN0UGFyYW1zIHwgRGF0ZSxcbiAgICByZXF1ZXN0RGF0ZT86IERhdGUsXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCB2YWxpZFJlc3BIZWFkZXJzID0gW1xuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtdHlwZScsXG4gICAgICAncmVzcG9uc2UtY29udGVudC1sYW5ndWFnZScsXG4gICAgICAncmVzcG9uc2UtZXhwaXJlcycsXG4gICAgICAncmVzcG9uc2UtY2FjaGUtY29udHJvbCcsXG4gICAgICAncmVzcG9uc2UtY29udGVudC1kaXNwb3NpdGlvbicsXG4gICAgICAncmVzcG9uc2UtY29udGVudC1lbmNvZGluZycsXG4gICAgXVxuICAgIHZhbGlkUmVzcEhlYWRlcnMuZm9yRWFjaCgoaGVhZGVyKSA9PiB7XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICBpZiAocmVzcEhlYWRlcnMgIT09IHVuZGVmaW5lZCAmJiByZXNwSGVhZGVyc1toZWFkZXJdICE9PSB1bmRlZmluZWQgJiYgIWlzU3RyaW5nKHJlc3BIZWFkZXJzW2hlYWRlcl0pKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYHJlc3BvbnNlIGhlYWRlciAke2hlYWRlcn0gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcImApXG4gICAgICB9XG4gICAgfSlcbiAgICByZXR1cm4gdGhpcy5wcmVzaWduZWRVcmwoJ0dFVCcsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGV4cGlyZXMsIHJlc3BIZWFkZXJzLCByZXF1ZXN0RGF0ZSlcbiAgfVxuXG4gIGFzeW5jIHByZXNpZ25lZFB1dE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgZXhwaXJlcz86IG51bWJlcik6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5wcmVzaWduZWRVcmwoJ1BVVCcsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGV4cGlyZXMpXG4gIH1cblxuICBuZXdQb3N0UG9saWN5KCk6IFBvc3RQb2xpY3kge1xuICAgIHJldHVybiBuZXcgUG9zdFBvbGljeSgpXG4gIH1cblxuICBhc3luYyBwcmVzaWduZWRQb3N0UG9saWN5KHBvc3RQb2xpY3k6IFBvc3RQb2xpY3kpOiBQcm9taXNlPFBvc3RQb2xpY3lSZXN1bHQ+IHtcbiAgICBpZiAodGhpcy5hbm9ueW1vdXMpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuQW5vbnltb3VzUmVxdWVzdEVycm9yKCdQcmVzaWduZWQgUE9TVCBwb2xpY3kgY2Fubm90IGJlIGdlbmVyYXRlZCBmb3IgYW5vbnltb3VzIHJlcXVlc3RzJylcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChwb3N0UG9saWN5KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncG9zdFBvbGljeSBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgY29uc3QgYnVja2V0TmFtZSA9IHBvc3RQb2xpY3kuZm9ybURhdGEuYnVja2V0IGFzIHN0cmluZ1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZWdpb24gPSBhd2FpdCB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWUpXG5cbiAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpXG4gICAgICBjb25zdCBkYXRlU3RyID0gbWFrZURhdGVMb25nKGRhdGUpXG4gICAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcblxuICAgICAgaWYgKCFwb3N0UG9saWN5LnBvbGljeS5leHBpcmF0aW9uKSB7XG4gICAgICAgIC8vICdleHBpcmF0aW9uJyBpcyBtYW5kYXRvcnkgZmllbGQgZm9yIFMzLlxuICAgICAgICAvLyBTZXQgZGVmYXVsdCBleHBpcmF0aW9uIGRhdGUgb2YgNyBkYXlzLlxuICAgICAgICBjb25zdCBleHBpcmVzID0gbmV3IERhdGUoKVxuICAgICAgICBleHBpcmVzLnNldFNlY29uZHMoUFJFU0lHTl9FWFBJUllfREFZU19NQVgpXG4gICAgICAgIHBvc3RQb2xpY3kuc2V0RXhwaXJlcyhleHBpcmVzKVxuICAgICAgfVxuXG4gICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotZGF0ZScsIGRhdGVTdHJdKVxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotZGF0ZSddID0gZGF0ZVN0clxuXG4gICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotYWxnb3JpdGhtJywgJ0FXUzQtSE1BQy1TSEEyNTYnXSlcbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LWFsZ29yaXRobSddID0gJ0FXUzQtSE1BQy1TSEEyNTYnXG5cbiAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1jcmVkZW50aWFsJywgdGhpcy5hY2Nlc3NLZXkgKyAnLycgKyBnZXRTY29wZShyZWdpb24sIGRhdGUpXSlcbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LWNyZWRlbnRpYWwnXSA9IHRoaXMuYWNjZXNzS2V5ICsgJy8nICsgZ2V0U2NvcGUocmVnaW9uLCBkYXRlKVxuXG4gICAgICBpZiAodGhpcy5zZXNzaW9uVG9rZW4pIHtcbiAgICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LXNlY3VyaXR5LXRva2VuJywgdGhpcy5zZXNzaW9uVG9rZW5dKVxuICAgICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1zZWN1cml0eS10b2tlbiddID0gdGhpcy5zZXNzaW9uVG9rZW5cbiAgICAgIH1cblxuICAgICAgY29uc3QgcG9saWN5QmFzZTY0ID0gQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkocG9zdFBvbGljeS5wb2xpY3kpKS50b1N0cmluZygnYmFzZTY0JylcblxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YS5wb2xpY3kgPSBwb2xpY3lCYXNlNjRcblxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotc2lnbmF0dXJlJ10gPSBwb3N0UHJlc2lnblNpZ25hdHVyZVY0KHJlZ2lvbiwgZGF0ZSwgdGhpcy5zZWNyZXRLZXksIHBvbGljeUJhc2U2NClcbiAgICAgIGNvbnN0IG9wdHMgPSB7XG4gICAgICAgIHJlZ2lvbjogcmVnaW9uLFxuICAgICAgICBidWNrZXROYW1lOiBidWNrZXROYW1lLFxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKG9wdHMpXG4gICAgICBjb25zdCBwb3J0U3RyID0gdGhpcy5wb3J0ID09IDgwIHx8IHRoaXMucG9ydCA9PT0gNDQzID8gJycgOiBgOiR7dGhpcy5wb3J0LnRvU3RyaW5nKCl9YFxuICAgICAgY29uc3QgdXJsU3RyID0gYCR7cmVxT3B0aW9ucy5wcm90b2NvbH0vLyR7cmVxT3B0aW9ucy5ob3N0fSR7cG9ydFN0cn0ke3JlcU9wdGlvbnMucGF0aH1gXG4gICAgICByZXR1cm4geyBwb3N0VVJMOiB1cmxTdHIsIGZvcm1EYXRhOiBwb3N0UG9saWN5LmZvcm1EYXRhIH1cbiAgICB9IGNhdGNoIChlcikge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgVW5hYmxlIHRvIGdldCBidWNrZXQgcmVnaW9uIGZvciAgJHtidWNrZXROYW1lfS5gKVxuICAgIH1cbiAgfVxufVxuIl0sIm1hcHBpbmdzIjoiOzs7OztBQUFBLElBQUFBLE1BQUEsR0FBQUMsdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFDLEVBQUEsR0FBQUYsdUJBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFFLElBQUEsR0FBQUgsdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFHLEtBQUEsR0FBQUosdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFJLElBQUEsR0FBQUwsdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFLLE1BQUEsR0FBQU4sdUJBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFNLEtBQUEsR0FBQVAsdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFPLFlBQUEsR0FBQVAsT0FBQTtBQUNBLElBQUFRLGNBQUEsR0FBQVIsT0FBQTtBQUNBLElBQUFTLE9BQUEsR0FBQVQsT0FB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