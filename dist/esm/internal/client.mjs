import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import * as stream from "stream";
import * as async from 'async';
import BlockStream2 from 'block-stream2';
import { isBrowser } from 'browser-or-node';
import _ from 'lodash';
import * as qs from 'query-string';
import xml2js from 'xml2js';
import { CredentialProvider } from "../CredentialProvider.mjs";
import * as errors from "../errors.mjs";
import { CopyDestinationOptions, CopySourceOptions, DEFAULT_REGION, LEGAL_HOLD_STATUS, PRESIGN_EXPIRY_DAYS_MAX, RETENTION_MODES, RETENTION_VALIDITY_UNITS } from "../helpers.mjs";
import { postPresignSignatureV4, presignSignatureV4, signV4 } from "../signing.mjs";
import { fsp, streamPromise } from "./async.mjs";
import { CopyConditions } from "./copy-conditions.mjs";
import { Extensions } from "./extensions.mjs";
import { calculateEvenSplits, extractMetadata, getContentLength, getScope, getSourceVersionId, getVersionId, hashBinary, insertContentType, isAmazonEndpoint, isBoolean, isDefined, isEmpty, isNumber, isObject, isReadableStream, isString, isValidBucketName, isValidEndpoint, isValidObjectName, isValidPort, isValidPrefix, isVirtualHostStyle, makeDateLong, PART_CONSTRAINTS, partsRequired, prependXAMZMeta, readableStream, sanitizeETag, toMd5, toSha256, uriEscape, uriResourceEscape } from "./helper.mjs";
import { joinHostPort } from "./join-host-port.mjs";
import { PostPolicy } from "./post-policy.mjs";
import { request } from "./request.mjs";
import { drainResponse, readAsBuffer, readAsString } from "./response.mjs";
import { getS3Endpoint } from "./s3-endpoints.mjs";
import * as xmlParsers from "./xml-parser.mjs";
import { parseCompleteMultipart, parseInitiateMultipart, parseObjectLegalHoldConfig, parseSelectObjectContentResponse, uploadPartParser } from "./xml-parser.mjs";
const xml = new xml2js.Builder({
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
export class TypedClient {
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
    if (!isValidEndpoint(params.endPoint)) {
      throw new errors.InvalidEndpointError(`Invalid endPoint : ${params.endPoint}`);
    }
    if (!isValidPort(params.port)) {
      throw new errors.InvalidArgumentError(`Invalid port : ${params.port}`);
    }
    if (!isBoolean(params.useSSL)) {
      throw new errors.InvalidArgumentError(`Invalid useSSL flag type : ${params.useSSL}, expected to be of type "boolean"`);
    }

    // Validate region only if its set.
    if (params.region) {
      if (!isString(params.region)) {
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
      if (!isObject(params.transport)) {
        throw new errors.InvalidArgumentError(`Invalid transport type : ${params.transport}, expected to be type "object"`);
      }
      transport = params.transport;
    }

    // if custom transport agent is set, use it.
    if (params.transportAgent) {
      if (!isObject(params.transportAgent)) {
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
    this.clientExtensions = new Extensions(this);
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
    if (!isObject(options)) {
      throw new TypeError('request options should be of type "object"');
    }
    this.reqOptions = _.pick(options, requestOptionProperties);
  }

  /**
   *  This is s3 Specific and does not hold validity in any other Object storage.
   */
  getAccelerateEndPointIfSet(bucketName, objectName) {
    if (!isEmpty(this.s3AccelerateEndpoint) && !isEmpty(bucketName) && !isEmpty(objectName)) {
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
    if (!isString(appName)) {
      throw new TypeError(`Invalid appName: ${appName}`);
    }
    if (appName.trim() === '') {
      throw new errors.InvalidArgumentError('Input appName cannot be empty.');
    }
    if (!isString(appVersion)) {
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
      virtualHostStyle = isVirtualHostStyle(this.host, this.protocol, bucketName, this.pathStyle);
    }
    let path = '/';
    let host = this.host;
    let port;
    if (this.port) {
      port = this.port;
    }
    if (objectName) {
      objectName = uriResourceEscape(objectName);
    }

    // For Amazon S3 endpoint, get endpoint based on region.
    if (isAmazonEndpoint(host)) {
      const accelerateEndPoint = this.getAccelerateEndPointIfSet(bucketName, objectName);
      if (accelerateEndPoint) {
        host = `${accelerateEndPoint}`;
      } else {
        host = getS3Endpoint(region);
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
      reqOptions.headers.host = joinHostPort(host, port);
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
      headers: _.mapValues(_.pickBy(reqOptions.headers, isDefined), v => v.toString()),
      host,
      port,
      path
    };
  }
  async setCredentialsProvider(credentialsProvider) {
    if (!(credentialsProvider instanceof CredentialProvider)) {
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
    if (!isObject(reqOptions)) {
      throw new TypeError('reqOptions should be of type "object"');
    }
    if (response && !isReadableStream(response)) {
      throw new TypeError('response should be of type "Stream"');
    }
    if (err && !(err instanceof Error)) {
      throw new TypeError('err should be of type "Error"');
    }
    const logStream = this.logStream;
    const logHeaders = headers => {
      Object.entries(headers).forEach(([k, v]) => {
        if (k == 'authorization') {
          if (isString(v)) {
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
    if (!isObject(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!isString(payload) && !isObject(payload)) {
      // Buffer is of type 'object'
      throw new TypeError('payload should be of type "string" or "Buffer"');
    }
    expectedCodes.forEach(statusCode => {
      if (!isNumber(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!options.headers) {
      options.headers = {};
    }
    if (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE') {
      options.headers['content-length'] = payload.length.toString();
    }
    const sha256sum = this.enableSHA256 ? toSha256(payload) : '';
    return this.makeRequestStreamAsync(options, payload, sha256sum, expectedCodes, region);
  }

  /**
   * new request with promise
   *
   * No need to drain response, response body is not valid
   */
  async makeRequestAsyncOmit(options, payload = '', statusCodes = [200], region = '') {
    const res = await this.makeRequestAsync(options, payload, statusCodes, region);
    await drainResponse(res);
    return res;
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @internal
   */
  async makeRequestStreamAsync(options, body, sha256sum, statusCodes, region) {
    if (!isObject(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(Buffer.isBuffer(body) || typeof body === 'string' || isReadableStream(body))) {
      throw new errors.InvalidArgumentError(`stream should be a Buffer, string or readable Stream, got ${typeof body} instead`);
    }
    if (!isString(sha256sum)) {
      throw new TypeError('sha256sum should be of type "string"');
    }
    statusCodes.forEach(statusCode => {
      if (!isNumber(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!isString(region)) {
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
      reqOptions.headers['x-amz-date'] = makeDateLong(date);
      reqOptions.headers['x-amz-content-sha256'] = sha256sum;
      if (this.sessionToken) {
        reqOptions.headers['x-amz-security-token'] = this.sessionToken;
      }
      reqOptions.headers.authorization = signV4(reqOptions, this.accessKey, this.secretKey, region, date, sha256sum);
    }
    const response = await request(this.transport, reqOptions, body);
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
    if (!isValidBucketName(bucketName)) {
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
      const body = await readAsString(response);
      const region = xmlParsers.parseBucketRegion(body) || DEFAULT_REGION;
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
    const pathStyle = this.pathStyle && !isBrowser;
    let region;
    try {
      const res = await this.makeRequestAsync({
        method,
        bucketName,
        query,
        pathStyle
      }, '', [200], DEFAULT_REGION);
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
        await drainResponse(res);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    // Backward Compatibility
    if (isObject(region)) {
      makeOpts = region;
      region = '';
    }
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!isObject(makeOpts)) {
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
    if (region && region !== DEFAULT_REGION) {
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
    const finalRegion = this.region || region || DEFAULT_REGION;
    const requestOpt = {
      method,
      bucketName,
      headers
    };
    try {
      await this.makeRequestAsyncOmit(requestOpt, payload, [200], finalRegion);
    } catch (err) {
      if (region === '' || region === DEFAULT_REGION) {
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
    if (!isValidBucketName(bucketName)) {
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
    if (!isValidBucketName(bucketName)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isNumber(offset)) {
      throw new TypeError('offset should be of type "number"');
    }
    if (!isNumber(length)) {
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
      ...prependXAMZMeta(sseHeaders),
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    const downloadToTmpFile = async () => {
      let partFileStream;
      const objStat = await this.statObject(bucketName, objectName, getOpts);
      const partFile = `${filePath}.${objStat.etag}.part.minio`;
      await fsp.mkdir(path.dirname(filePath), {
        recursive: true
      });
      let offset = 0;
      try {
        const stats = await fsp.stat(partFile);
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
      await streamPromise.pipeline(downloadStream, partFileStream);
      const stats = await fsp.stat(partFile);
      if (stats.size === objStat.size) {
        return partFile;
      }
      throw new Error('Size mismatch between downloaded file and the object');
    };
    const partFile = await downloadToTmpFile();
    await fsp.rename(partFile, filePath);
  }

  /**
   * Stat information of the object.
   */
  async statObject(bucketName, objectName, statOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(statOpts)) {
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
      metaData: extractMetadata(res.headers),
      lastModified: new Date(res.headers['last-modified']),
      versionId: getVersionId(res.headers),
      etag: sanitizeETag(res.headers.etag)
    };
  }
  async removeObject(bucketName, objectName, removeOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (removeOpts && !isObject(removeOpts)) {
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
    if (!isValidBucketName(bucket)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucket);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isBoolean(recursive)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isString(keyMarker)) {
      throw new TypeError('keyMarker should be of type "string"');
    }
    if (!isString(uploadIdMarker)) {
      throw new TypeError('uploadIdMarker should be of type "string"');
    }
    if (!isString(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    const queries = [];
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(delimiter)}`);
    if (keyMarker) {
      queries.push(`key-marker=${uriEscape(keyMarker)}`);
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
    const body = await readAsString(res);
    return xmlParsers.parseListMultipart(body);
  }

  /**
   * Initiate a new multipart upload.
   * @internal
   */
  async initiateNewMultipartUpload(bucketName, objectName, headers) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(headers)) {
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
    const body = await readAsBuffer(res);
    return parseInitiateMultipart(body.toString());
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!isObject(etags)) {
      throw new TypeError('etags should be of type "Array"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const method = 'POST';
    const query = `uploadId=${uriEscape(uploadId)}`;
    const builder = new xml2js.Builder();
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
    const body = await readAsBuffer(res);
    const result = parseCompleteMultipart(body.toString());
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
      versionId: getVersionId(res.headers)
    };
  }

  /**
   * Get part-info of all parts of an incomplete upload specified by uploadId.
   */
  async listParts(bucketName, objectName, uploadId) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!isNumber(marker)) {
      throw new TypeError('marker should be of type "number"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    let query = `uploadId=${uriEscape(uploadId)}`;
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
    return xmlParsers.parseListParts(await readAsString(res));
  }
  async listBuckets() {
    const method = 'GET';
    const regionConf = this.region || DEFAULT_REGION;
    const httpRes = await this.makeRequestAsync({
      method
    }, '', [200], regionConf);
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseListBucket(xmlResult);
  }

  /**
   * Calculate part size given the object size. Part size will be atleast this.partSize
   */
  calculatePartSize(size) {
    if (!isNumber(size)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    if (!isObject(metaData)) {
      throw new TypeError('metaData should be of type "object"');
    }

    // Inserts correct `content-type` attribute based on metaData and filePath
    metaData = insertContentType(metaData, filePath);
    const stat = await fsp.lstat(filePath);
    await this.putObject(bucketName, objectName, fs.createReadStream(filePath), stat.size, metaData);
  }

  /**
   *  Uploading a stream, "Buffer" or "string".
   *  It's recommended to pass `size` argument with stream.
   */
  async putObject(bucketName, objectName, stream, size, metaData) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }

    // We'll need to shift arguments to the left because of metaData
    // and size being optional.
    if (isObject(size)) {
      metaData = size;
    }
    // Ensures Metadata has appropriate prefix for A3 API
    const headers = prependXAMZMeta(metaData);
    if (typeof stream === 'string' || stream instanceof Buffer) {
      // Adapts the non-stream interface into a stream.
      size = stream.length;
      stream = readableStream(stream);
    } else if (!isReadableStream(stream)) {
      throw new TypeError('third argument should be of type "stream.Readable" or "Buffer" or "string"');
    }
    if (isNumber(size) && size < 0) {
      throw new errors.InvalidArgumentError(`size cannot be negative, given size: ${size}`);
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (!isNumber(size)) {
      size = this.maxObjectSize;
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (size === undefined) {
      const statSize = await getContentLength(stream);
      if (statSize !== null) {
        size = statSize;
      }
    }
    if (!isNumber(size)) {
      // Backward compatibility
      size = this.maxObjectSize;
    }
    const partSize = this.calculatePartSize(size);
    if (typeof stream === 'string' || Buffer.isBuffer(stream) || size <= partSize) {
      const buf = isReadableStream(stream) ? await readAsBuffer(stream) : Buffer.from(stream);
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
    } = hashBinary(buf, this.enableSHA256);
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
    await drainResponse(res);
    return {
      etag: sanitizeETag(res.headers.etag),
      versionId: getVersionId(res.headers)
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
    const chunkier = new BlockStream2({
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
    if (!isValidBucketName(bucketName)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isObject(replicationConfig)) {
      throw new errors.InvalidArgumentError('replicationConfig should be of type "object"');
    } else {
      if (_.isEmpty(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Role cannot be empty');
      } else if (replicationConfig.role && !isString(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Invalid value for role', replicationConfig.role);
      }
      if (_.isEmpty(replicationConfig.rules)) {
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
    const builder = new xml2js.Builder({
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(replicationParamsConfig);
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketReplication(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'replication';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    }, '', [200, 204]);
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseReplicationConfig(xmlResult);
  }
  async getObjectLegalHold(bucketName, objectName, getOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts) {
      if (!isObject(getOpts)) {
        throw new TypeError('getOpts should be of type "Object"');
      } else if (Object.keys(getOpts).length > 0 && getOpts.versionId && !isString(getOpts.versionId)) {
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
    const strRes = await readAsString(httpRes);
    return parseObjectLegalHoldConfig(strRes);
  }
  async setObjectLegalHold(bucketName, objectName, setOpts = {
    status: LEGAL_HOLD_STATUS.ENABLED
  }) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(setOpts)) {
      throw new TypeError('setOpts should be of type "Object"');
    } else {
      if (![LEGAL_HOLD_STATUS.ENABLED, LEGAL_HOLD_STATUS.DISABLED].includes(setOpts === null || setOpts === void 0 ? void 0 : setOpts.status)) {
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
    const builder = new xml2js.Builder({
      rootName: 'LegalHold',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
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
    if (!isValidBucketName(bucketName)) {
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
    const body = await readAsString(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Get the tags associated with a bucket OR an object
   */
  async getObjectTagging(bucketName, objectName, getOpts = {}) {
    const method = 'GET';
    let query = 'tagging';
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (!isObject(getOpts)) {
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
    const body = await readAsString(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Set the policy on a bucket or an object prefix.
   */
  async setBucketPolicy(bucketName, policy) {
    // Validate arguments.
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isString(policy)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'policy';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    return await readAsString(res);
  }
  async putObjectRetention(bucketName, objectName, retentionOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(retentionOpts)) {
      throw new errors.InvalidArgumentError('retentionOpts should be of type "object"');
    } else {
      if (retentionOpts.governanceBypass && !isBoolean(retentionOpts.governanceBypass)) {
        throw new errors.InvalidArgumentError(`Invalid value for governanceBypass: ${retentionOpts.governanceBypass}`);
      }
      if (retentionOpts.mode && ![RETENTION_MODES.COMPLIANCE, RETENTION_MODES.GOVERNANCE].includes(retentionOpts.mode)) {
        throw new errors.InvalidArgumentError(`Invalid object retention mode: ${retentionOpts.mode}`);
      }
      if (retentionOpts.retainUntilDate && !isString(retentionOpts.retainUntilDate)) {
        throw new errors.InvalidArgumentError(`Invalid value for retainUntilDate: ${retentionOpts.retainUntilDate}`);
      }
      if (retentionOpts.versionId && !isString(retentionOpts.versionId)) {
        throw new errors.InvalidArgumentError(`Invalid value for versionId: ${retentionOpts.versionId}`);
      }
    }
    const method = 'PUT';
    let query = 'retention';
    const headers = {};
    if (retentionOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    const builder = new xml2js.Builder({
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
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload, [200, 204]);
  }
  async getObjectLockConfig(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'object-lock';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseObjectLockConfig(xmlResult);
  }
  async setObjectLockConfig(bucketName, lockConfigOpts) {
    const retentionModes = [RETENTION_MODES.COMPLIANCE, RETENTION_MODES.GOVERNANCE];
    const validUnits = [RETENTION_VALIDITY_UNITS.DAYS, RETENTION_VALIDITY_UNITS.YEARS];
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (lockConfigOpts.mode && !retentionModes.includes(lockConfigOpts.mode)) {
      throw new TypeError(`lockConfigOpts.mode should be one of ${retentionModes}`);
    }
    if (lockConfigOpts.unit && !validUnits.includes(lockConfigOpts.unit)) {
      throw new TypeError(`lockConfigOpts.unit should be one of ${validUnits}`);
    }
    if (lockConfigOpts.validity && !isNumber(lockConfigOpts.validity)) {
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
        if (lockConfigOpts.unit === RETENTION_VALIDITY_UNITS.DAYS) {
          config.Rule.DefaultRetention.Days = lockConfigOpts.validity;
        } else if (lockConfigOpts.unit === RETENTION_VALIDITY_UNITS.YEARS) {
          config.Rule.DefaultRetention.Years = lockConfigOpts.validity;
        }
      }
    }
    const builder = new xml2js.Builder({
      rootName: 'ObjectLockConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketVersioning(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'versioning';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await readAsString(httpRes);
    return await xmlParsers.parseBucketVersioningConfig(xmlResult);
  }
  async setBucketVersioning(bucketName, versionConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Object.keys(versionConfig).length) {
      throw new errors.InvalidArgumentError('versionConfig should be of type "object"');
    }
    const method = 'PUT';
    const query = 'versioning';
    const builder = new xml2js.Builder({
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
    const builder = new xml2js.Builder({
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
    headers['Content-MD5'] = toMd5(payloadBuf);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isObject(tags)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    await this.removeTagging({
      bucketName
    });
  }
  async setObjectTagging(bucketName, objectName, tags, putOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (!isObject(tags)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (removeOpts && Object.keys(removeOpts).length && !isObject(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    await this.removeTagging({
      bucketName,
      objectName,
      removeOpts
    });
  }
  async selectObjectContent(bucketName, objectName, selectOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!_.isEmpty(selectOpts)) {
      if (!isString(selectOpts.expression)) {
        throw new TypeError('sqlExpression should be of type "string"');
      }
      if (!_.isEmpty(selectOpts.inputSerialization)) {
        if (!isObject(selectOpts.inputSerialization)) {
          throw new TypeError('inputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('inputSerialization is required');
      }
      if (!_.isEmpty(selectOpts.outputSerialization)) {
        if (!isObject(selectOpts.outputSerialization)) {
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
    const builder = new xml2js.Builder({
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
    const body = await readAsBuffer(res);
    return parseSelectObjectContentResponse(body);
  }
  async applyBucketLifecycle(bucketName, policyConfig) {
    const method = 'PUT';
    const query = 'lifecycle';
    const headers = {};
    const builder = new xml2js.Builder({
      rootName: 'LifecycleConfiguration',
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    const payload = builder.buildObject(policyConfig);
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async removeBucketLifecycle(bucketName) {
    if (!isValidBucketName(bucketName)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (_.isEmpty(lifeCycleConfig)) {
      await this.removeBucketLifecycle(bucketName);
    } else {
      await this.applyBucketLifecycle(bucketName, lifeCycleConfig);
    }
  }
  async getBucketLifecycle(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'lifecycle';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    return xmlParsers.parseLifecycleConfig(body);
  }
  async setBucketEncryption(bucketName, encryptionConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!_.isEmpty(encryptionConfig) && encryptionConfig.Rule.length > 1) {
      throw new errors.InvalidArgumentError('Invalid Rule length. Only one rule is allowed.: ' + encryptionConfig.Rule);
    }
    let encryptionObj = encryptionConfig;
    if (_.isEmpty(encryptionConfig)) {
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
    const builder = new xml2js.Builder({
      rootName: 'ServerSideEncryptionConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(encryptionObj);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketEncryption(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'encryption';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    return xmlParsers.parseBucketEncryptionConfig(body);
  }
  async removeBucketEncryption(bucketName) {
    if (!isValidBucketName(bucketName)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts && !isObject(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    } else if (getOpts !== null && getOpts !== void 0 && getOpts.versionId && !isString(getOpts.versionId)) {
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
    const body = await readAsString(res);
    return xmlParsers.parseObjectRetentionConfig(body);
  }
  async removeObjects(bucketName, objectsList) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Array.isArray(objectsList)) {
      throw new errors.InvalidArgumentError('objectsList should be a list');
    }
    const runDeleteObjects = async batch => {
      const delObjects = batch.map(value => {
        return isObject(value) ? {
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
      const payload = Buffer.from(new xml2js.Builder({
        headless: true
      }).buildObject(remObjects));
      const headers = {
        'Content-MD5': toMd5(payload)
      };
      const res = await this.makeRequestAsync({
        method: 'POST',
        bucketName,
        query: 'delete',
        headers
      }, payload);
      const body = await readAsString(res);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.IsValidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
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
    if (!isValidBucketName(targetBucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + targetBucketName);
    }
    if (!isValidObjectName(targetObjectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${targetObjectName}`);
    }
    if (!isString(sourceBucketNameAndObjectName)) {
      throw new TypeError('sourceBucketNameAndObjectName should be of type "string"');
    }
    if (sourceBucketNameAndObjectName === '') {
      throw new errors.InvalidPrefixError(`Empty source prefix`);
    }
    if (conditions != null && !(conditions instanceof CopyConditions)) {
      throw new TypeError('conditions should be of type "CopyConditions"');
    }
    const headers = {};
    headers['x-amz-copy-source'] = uriResourceEscape(sourceBucketNameAndObjectName);
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
    const body = await readAsString(res);
    return xmlParsers.parseCopyObject(body);
  }
  async copyObjectV2(sourceConfig, destConfig) {
    if (!(sourceConfig instanceof CopySourceOptions)) {
      throw new errors.InvalidArgumentError('sourceConfig should of type CopySourceOptions ');
    }
    if (!(destConfig instanceof CopyDestinationOptions)) {
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
    const body = await readAsString(res);
    const copyRes = xmlParsers.parseCopyObject(body);
    const resHeaders = res.headers;
    const sizeHeaderValue = resHeaders && resHeaders['content-length'];
    const size = typeof sizeHeaderValue === 'number' ? sizeHeaderValue : undefined;
    return {
      Bucket: destConfig.Bucket,
      Key: destConfig.Object,
      LastModified: copyRes.lastModified,
      MetaData: extractMetadata(resHeaders),
      VersionId: getVersionId(resHeaders),
      SourceVersionId: getSourceVersionId(resHeaders),
      Etag: sanitizeETag(resHeaders.etag),
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
    const body = await readAsString(res);
    const partRes = uploadPartParser(body);
    return {
      etag: sanitizeETag(partRes.ETag),
      key: objectName,
      part: partNumber
    };
  }
  async composeObject(destObjConfig, sourceObjList) {
    const sourceFilesLength = sourceObjList.length;
    if (!Array.isArray(sourceObjList)) {
      throw new errors.InvalidArgumentError('sourceConfig should an array of CopySourceOptions ');
    }
    if (!(destObjConfig instanceof CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (sourceFilesLength < 1 || sourceFilesLength > PART_CONSTRAINTS.MAX_PARTS_COUNT) {
      throw new errors.InvalidArgumentError(`"There must be as least one and up to ${PART_CONSTRAINTS.MAX_PARTS_COUNT} source objects.`);
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
      if (!_.isEmpty(srcConfig.VersionID)) {
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
      if (srcCopySize < PART_CONSTRAINTS.ABS_MIN_PART_SIZE && index < sourceFilesLength - 1) {
        throw new errors.InvalidArgumentError(`CopySrcOptions ${index} is too small (${srcCopySize}) and it is not the last part.`);
      }

      // Is data to copy too large?
      totalSize += srcCopySize;
      if (totalSize > PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE) {
        throw new errors.InvalidArgumentError(`Cannot compose an object of size ${totalSize} (> 5TiB)`);
      }

      // record source size
      srcObjectSizes[index] = srcCopySize;

      // calculate parts needed for current source
      totalParts += partsRequired(srcCopySize);
      // Do we need more parts than we are allowed?
      if (totalParts > PART_CONSTRAINTS.MAX_PARTS_COUNT) {
        throw new errors.InvalidArgumentError(`Your proposed compose object requires more than ${PART_CONSTRAINTS.MAX_PARTS_COUNT} parts`);
      }
      return resItemStat;
    });
    if (totalParts === 1 && totalSize <= PART_CONSTRAINTS.MAX_PART_SIZE || totalSize === 0) {
      return await this.copyObject(sourceObjList[0], destObjConfig); // use copyObjectV2
    }

    // preserve etag to avoid modification of object while copying.
    for (let i = 0; i < sourceFilesLength; i++) {
      ;
      sourceObjList[i].MatchETag = validatedStats[i].etag;
    }
    const splitPartSizeList = validatedStats.map((resItemStat, idx) => {
      return calculateEvenSplits(srcObjectSizes[idx], sourceObjList[idx]);
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
      expires = PRESIGN_EXPIRY_DAYS_MAX;
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
      return presignSignatureV4(reqOptions, this.accessKey, this.secretKey, this.sessionToken, region, requestDate, expires);
    } catch (err) {
      throw new errors.InvalidArgumentError(`Unable to get bucket region for  ${bucketName}.`);
    }
  }
  async presignedGetObject(bucketName, objectName, expires, respHeaders, requestDate) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const validRespHeaders = ['response-content-type', 'response-content-language', 'response-expires', 'response-cache-control', 'response-content-disposition', 'response-content-encoding'];
    validRespHeaders.forEach(header => {
      // @ts-ignore
      if (respHeaders !== undefined && respHeaders[header] !== undefined && !isString(respHeaders[header])) {
        throw new TypeError(`response header ${header} should be of type "string"`);
      }
    });
    return this.presignedUrl('GET', bucketName, objectName, expires, respHeaders, requestDate);
  }
  async presignedPutObject(bucketName, objectName, expires) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.presignedUrl('PUT', bucketName, objectName, expires);
  }
  newPostPolicy() {
    return new PostPolicy();
  }
  async presignedPostPolicy(postPolicy) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned POST policy cannot be generated for anonymous requests');
    }
    if (!isObject(postPolicy)) {
      throw new TypeError('postPolicy should be of type "object"');
    }
    const bucketName = postPolicy.formData.bucket;
    try {
      const region = await this.getBucketRegionAsync(bucketName);
      const date = new Date();
      const dateStr = makeDateLong(date);
      await this.checkAndRefreshCreds();
      if (!postPolicy.policy.expiration) {
        // 'expiration' is mandatory field for S3.
        // Set default expiration date of 7 days.
        const expires = new Date();
        expires.setSeconds(PRESIGN_EXPIRY_DAYS_MAX);
        postPolicy.setExpires(expires);
      }
      postPolicy.policy.conditions.push(['eq', '$x-amz-date', dateStr]);
      postPolicy.formData['x-amz-date'] = dateStr;
      postPolicy.policy.conditions.push(['eq', '$x-amz-algorithm', 'AWS4-HMAC-SHA256']);
      postPolicy.formData['x-amz-algorithm'] = 'AWS4-HMAC-SHA256';
      postPolicy.policy.conditions.push(['eq', '$x-amz-credential', this.accessKey + '/' + getScope(region, date)]);
      postPolicy.formData['x-amz-credential'] = this.accessKey + '/' + getScope(region, date);
      if (this.sessionToken) {
        postPolicy.policy.conditions.push(['eq', '$x-amz-security-token', this.sessionToken]);
        postPolicy.formData['x-amz-security-token'] = this.sessionToken;
      }
      const policyBase64 = Buffer.from(JSON.stringify(postPolicy.policy)).toString('base64');
      postPolicy.formData.policy = policyBase64;
      postPolicy.formData['x-amz-signature'] = postPresignSignatureV4(region, date, this.secretKey, policyBase64);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJmcyIsImh0dHAiLCJodHRwcyIsInBhdGgiLCJzdHJlYW0iLCJhc3luYyIsIkJsb2NrU3RyZWFtMiIsImlzQnJvd3NlciIsIl8iLCJxcyIsInhtbDJqcyIsIkNyZWRlbnRpYWxQcm92aWRlciIsImVycm9ycyIsIkNvcHlEZXN0aW5hdGlvbk9wdGlvbnMiLCJDb3B5U291cmNlT3B0aW9ucyIsIkRFRkFVTFRfUkVHSU9OIiwiTEVHQUxfSE9MRF9TVEFUVVMiLCJQUkVTSUdOX0VYUElSWV9EQVlTX01BWCIsIlJFVEVOVElPTl9NT0RFUyIsIlJFVEVOVElPTl9WQUxJRElUWV9VTklUUyIsInBvc3RQcmVzaWduU2lnbmF0dXJlVjQiLCJwcmVzaWduU2lnbmF0dXJlVjQiLCJzaWduVjQiLCJmc3AiLCJzdHJlYW1Qcm9taXNlIiwiQ29weUNvbmRpdGlvbnMiLCJFeHRlbnNpb25zIiwiY2FsY3VsYXRlRXZlblNwbGl0cyIsImV4dHJhY3RNZXRhZGF0YSIsImdldENvbnRlbnRMZW5ndGgiLCJnZXRTY29wZSIsImdldFNvdXJjZVZlcnNpb25JZCIsImdldFZlcnNpb25JZCIsImhhc2hCaW5hcnkiLCJpbnNlcnRDb250ZW50VHlwZSIsImlzQW1hem9uRW5kcG9pbnQiLCJpc0Jvb2xlYW4iLCJpc0RlZmluZWQiLCJpc0VtcHR5IiwiaXNOdW1iZXIiLCJpc09iamVjdCIsImlzUmVhZGFibGVTdHJlYW0iLCJpc1N0cmluZyIsImlzVmFsaWRCdWNrZXROYW1lIiwiaXNWYWxpZEVuZHBvaW50IiwiaXNWYWxpZE9iamVjdE5hbWUiLCJpc1ZhbGlkUG9ydCIsImlzVmFsaWRQcmVmaXgiLCJpc1ZpcnR1YWxIb3N0U3R5bGUiLCJtYWtlRGF0ZUxvbmciLCJQQVJUX0NPTlNUUkFJTlRTIiwicGFydHNSZXF1aXJlZCIsInByZXBlbmRYQU1aTWV0YSIsInJlYWRhYmxlU3RyZWFtIiwic2FuaXRpemVFVGFnIiwidG9NZDUiLCJ0b1NoYTI1NiIsInVyaUVzY2FwZSIsInVyaVJlc291cmNlRXNjYXBlIiwiam9pbkhvc3RQb3J0IiwiUG9zdFBvbGljeSIsInJlcXVlc3QiLCJkcmFpblJlc3BvbnNlIiwicmVhZEFzQnVmZmVyIiwicmVhZEFzU3RyaW5nIiwiZ2V0UzNFbmRwb2ludCIsInhtbFBhcnNlcnMiLCJwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0IiwicGFyc2VJbml0aWF0ZU11bHRpcGFydCIsInBhcnNlT2JqZWN0TGVnYWxIb2xkQ29uZmlnIiwicGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UiLCJ1cGxvYWRQYXJ0UGFyc2VyIiwieG1sIiwiQnVpbGRlciIsInJlbmRlck9wdHMiLCJwcmV0dHkiLCJoZWFkbGVzcyIsIlBhY2thZ2UiLCJ2ZXJzaW9uIiwicmVxdWVzdE9wdGlvblByb3BlcnRpZXMiLCJUeXBlZENsaWVudCIsInBhcnRTaXplIiwibWF4aW11bVBhcnRTaXplIiwibWF4T2JqZWN0U2l6ZSIsImNvbnN0cnVjdG9yIiwicGFyYW1zIiwic2VjdXJlIiwidW5kZWZpbmVkIiwiRXJyb3IiLCJ1c2VTU0wiLCJwb3J0IiwiZW5kUG9pbnQiLCJJbnZhbGlkRW5kcG9pbnRFcnJvciIsIkludmFsaWRBcmd1bWVudEVycm9yIiwicmVnaW9uIiwiaG9zdCIsInRvTG93ZXJDYXNlIiwicHJvdG9jb2wiLCJ0cmFuc3BvcnQiLCJ0cmFuc3BvcnRBZ2VudCIsImdsb2JhbEFnZW50IiwibGlicmFyeUNvbW1lbnRzIiwicHJvY2VzcyIsInBsYXRmb3JtIiwiYXJjaCIsImxpYnJhcnlBZ2VudCIsInVzZXJBZ2VudCIsInBhdGhTdHlsZSIsImFjY2Vzc0tleSIsInNlY3JldEtleSIsInNlc3Npb25Ub2tlbiIsImFub255bW91cyIsImNyZWRlbnRpYWxzUHJvdmlkZXIiLCJyZWdpb25NYXAiLCJvdmVyUmlkZVBhcnRTaXplIiwiZW5hYmxlU0hBMjU2IiwiczNBY2NlbGVyYXRlRW5kcG9pbnQiLCJyZXFPcHRpb25zIiwiY2xpZW50RXh0ZW5zaW9ucyIsImV4dGVuc2lvbnMiLCJzZXRTM1RyYW5zZmVyQWNjZWxlcmF0ZSIsInNldFJlcXVlc3RPcHRpb25zIiwib3B0aW9ucyIsIlR5cGVFcnJvciIsInBpY2siLCJnZXRBY2NlbGVyYXRlRW5kUG9pbnRJZlNldCIsImJ1Y2tldE5hbWUiLCJvYmplY3ROYW1lIiwiaW5jbHVkZXMiLCJzZXRBcHBJbmZvIiwiYXBwTmFtZSIsImFwcFZlcnNpb24iLCJ0cmltIiwiZ2V0UmVxdWVzdE9wdGlvbnMiLCJvcHRzIiwibWV0aG9kIiwiaGVhZGVycyIsInF1ZXJ5IiwiYWdlbnQiLCJ2aXJ0dWFsSG9zdFN0eWxlIiwiYWNjZWxlcmF0ZUVuZFBvaW50IiwiayIsInYiLCJPYmplY3QiLCJlbnRyaWVzIiwiYXNzaWduIiwibWFwVmFsdWVzIiwicGlja0J5IiwidG9TdHJpbmciLCJzZXRDcmVkZW50aWFsc1Byb3ZpZGVyIiwiY2hlY2tBbmRSZWZyZXNoQ3JlZHMiLCJjcmVkZW50aWFsc0NvbmYiLCJnZXRDcmVkZW50aWFscyIsImdldEFjY2Vzc0tleSIsImdldFNlY3JldEtleSIsImdldFNlc3Npb25Ub2tlbiIsImUiLCJjYXVzZSIsImxvZ0hUVFAiLCJyZXNwb25zZSIsImVyciIsImxvZ1N0cmVhbSIsImxvZ0hlYWRlcnMiLCJmb3JFYWNoIiwicmVkYWN0b3IiLCJSZWdFeHAiLCJyZXBsYWNlIiwid3JpdGUiLCJzdGF0dXNDb2RlIiwiZXJySlNPTiIsIkpTT04iLCJzdHJpbmdpZnkiLCJ0cmFjZU9uIiwic3Rkb3V0IiwidHJhY2VPZmYiLCJtYWtlUmVxdWVzdEFzeW5jIiwicGF5bG9hZCIsImV4cGVjdGVkQ29kZXMiLCJsZW5ndGgiLCJzaGEyNTZzdW0iLCJtYWtlUmVxdWVzdFN0cmVhbUFzeW5jIiwibWFrZVJlcXVlc3RBc3luY09taXQiLCJzdGF0dXNDb2RlcyIsInJlcyIsImJvZHkiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImdldEJ1Y2tldFJlZ2lvbkFzeW5jIiwiZGF0ZSIsIkRhdGUiLCJhdXRob3JpemF0aW9uIiwicGFyc2VSZXNwb25zZUVycm9yIiwiSW52YWxpZEJ1Y2tldE5hbWVFcnJvciIsImNhY2hlZCIsImV4dHJhY3RSZWdpb25Bc3luYyIsInBhcnNlQnVja2V0UmVnaW9uIiwibmFtZSIsIlJlZ2lvbiIsIm1ha2VSZXF1ZXN0IiwicmV0dXJuUmVzcG9uc2UiLCJjYiIsInByb20iLCJ0aGVuIiwicmVzdWx0IiwibWFrZVJlcXVlc3RTdHJlYW0iLCJleGVjdXRvciIsImdldEJ1Y2tldFJlZ2lvbiIsIm1ha2VCdWNrZXQiLCJtYWtlT3B0cyIsImJ1aWxkT2JqZWN0IiwiQ3JlYXRlQnVja2V0Q29uZmlndXJhdGlvbiIsIiQiLCJ4bWxucyIsIkxvY2F0aW9uQ29uc3RyYWludCIsIk9iamVjdExvY2tpbmciLCJmaW5hbFJlZ2lvbiIsInJlcXVlc3RPcHQiLCJTM0Vycm9yIiwiZXJyQ29kZSIsImNvZGUiLCJlcnJSZWdpb24iLCJidWNrZXRFeGlzdHMiLCJyZW1vdmVCdWNrZXQiLCJnZXRPYmplY3QiLCJnZXRPcHRzIiwiSW52YWxpZE9iamVjdE5hbWVFcnJvciIsImdldFBhcnRpYWxPYmplY3QiLCJvZmZzZXQiLCJyYW5nZSIsInNzZUhlYWRlcnMiLCJTU0VDdXN0b21lckFsZ29yaXRobSIsIlNTRUN1c3RvbWVyS2V5IiwiU1NFQ3VzdG9tZXJLZXlNRDUiLCJleHBlY3RlZFN0YXR1c0NvZGVzIiwicHVzaCIsImZHZXRPYmplY3QiLCJmaWxlUGF0aCIsImRvd25sb2FkVG9UbXBGaWxlIiwicGFydEZpbGVTdHJlYW0iLCJvYmpTdGF0Iiwic3RhdE9iamVjdCIsInBhcnRGaWxlIiwiZXRhZyIsIm1rZGlyIiwiZGlybmFtZSIsInJlY3Vyc2l2ZSIsInN0YXRzIiwic3RhdCIsInNpemUiLCJjcmVhdGVXcml0ZVN0cmVhbSIsImZsYWdzIiwiZG93bmxvYWRTdHJlYW0iLCJwaXBlbGluZSIsInJlbmFtZSIsInN0YXRPcHRzIiwicGFyc2VJbnQiLCJtZXRhRGF0YSIsImxhc3RNb2RpZmllZCIsInZlcnNpb25JZCIsInJlbW92ZU9iamVjdCIsInJlbW92ZU9wdHMiLCJnb3Zlcm5hbmNlQnlwYXNzIiwiZm9yY2VEZWxldGUiLCJxdWVyeVBhcmFtcyIsImxpc3RJbmNvbXBsZXRlVXBsb2FkcyIsImJ1Y2tldCIsInByZWZpeCIsIkludmFsaWRQcmVmaXhFcnJvciIsImRlbGltaXRlciIsImtleU1hcmtlciIsInVwbG9hZElkTWFya2VyIiwidXBsb2FkcyIsImVuZGVkIiwicmVhZFN0cmVhbSIsIlJlYWRhYmxlIiwib2JqZWN0TW9kZSIsIl9yZWFkIiwic2hpZnQiLCJsaXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeSIsInByZWZpeGVzIiwiZWFjaFNlcmllcyIsInVwbG9hZCIsImxpc3RQYXJ0cyIsImtleSIsInVwbG9hZElkIiwicGFydHMiLCJyZWR1Y2UiLCJhY2MiLCJpdGVtIiwiZW1pdCIsImlzVHJ1bmNhdGVkIiwibmV4dEtleU1hcmtlciIsIm5leHRVcGxvYWRJZE1hcmtlciIsInF1ZXJpZXMiLCJtYXhVcGxvYWRzIiwic29ydCIsInVuc2hpZnQiLCJqb2luIiwicGFyc2VMaXN0TXVsdGlwYXJ0IiwiaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQiLCJhYm9ydE11bHRpcGFydFVwbG9hZCIsInJlcXVlc3RPcHRpb25zIiwiZmluZFVwbG9hZElkIiwiX2xhdGVzdFVwbG9hZCIsImxhdGVzdFVwbG9hZCIsImluaXRpYXRlZCIsImdldFRpbWUiLCJjb21wbGV0ZU11bHRpcGFydFVwbG9hZCIsImV0YWdzIiwiYnVpbGRlciIsIkNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkIiwiUGFydCIsIm1hcCIsIlBhcnROdW1iZXIiLCJwYXJ0IiwiRVRhZyIsImVyck1lc3NhZ2UiLCJtYXJrZXIiLCJsaXN0UGFydHNRdWVyeSIsInBhcnNlTGlzdFBhcnRzIiwibGlzdEJ1Y2tldHMiLCJyZWdpb25Db25mIiwiaHR0cFJlcyIsInhtbFJlc3VsdCIsInBhcnNlTGlzdEJ1Y2tldCIsImNhbGN1bGF0ZVBhcnRTaXplIiwiZlB1dE9iamVjdCIsImxzdGF0IiwicHV0T2JqZWN0IiwiY3JlYXRlUmVhZFN0cmVhbSIsInN0YXRTaXplIiwiYnVmIiwiZnJvbSIsInVwbG9hZEJ1ZmZlciIsInVwbG9hZFN0cmVhbSIsIm1kNXN1bSIsIm9sZFBhcnRzIiwiZVRhZ3MiLCJwcmV2aW91c1VwbG9hZElkIiwib2xkVGFncyIsImNodW5raWVyIiwiemVyb1BhZGRpbmciLCJvIiwiUHJvbWlzZSIsImFsbCIsInJlc29sdmUiLCJyZWplY3QiLCJwaXBlIiwib24iLCJwYXJ0TnVtYmVyIiwiY2h1bmsiLCJtZDUiLCJjcmVhdGVIYXNoIiwidXBkYXRlIiwiZGlnZXN0Iiwib2xkUGFydCIsInJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uIiwic2V0QnVja2V0UmVwbGljYXRpb24iLCJyZXBsaWNhdGlvbkNvbmZpZyIsInJvbGUiLCJydWxlcyIsInJlcGxpY2F0aW9uUGFyYW1zQ29uZmlnIiwiUmVwbGljYXRpb25Db25maWd1cmF0aW9uIiwiUm9sZSIsIlJ1bGUiLCJnZXRCdWNrZXRSZXBsaWNhdGlvbiIsInBhcnNlUmVwbGljYXRpb25Db25maWciLCJnZXRPYmplY3RMZWdhbEhvbGQiLCJrZXlzIiwic3RyUmVzIiwic2V0T2JqZWN0TGVnYWxIb2xkIiwic2V0T3B0cyIsInN0YXR1cyIsIkVOQUJMRUQiLCJESVNBQkxFRCIsImNvbmZpZyIsIlN0YXR1cyIsInJvb3ROYW1lIiwiZ2V0QnVja2V0VGFnZ2luZyIsInBhcnNlVGFnZ2luZyIsImdldE9iamVjdFRhZ2dpbmciLCJzZXRCdWNrZXRQb2xpY3kiLCJwb2xpY3kiLCJJbnZhbGlkQnVja2V0UG9saWN5RXJyb3IiLCJnZXRCdWNrZXRQb2xpY3kiLCJwdXRPYmplY3RSZXRlbnRpb24iLCJyZXRlbnRpb25PcHRzIiwibW9kZSIsIkNPTVBMSUFOQ0UiLCJHT1ZFUk5BTkNFIiwicmV0YWluVW50aWxEYXRlIiwiTW9kZSIsIlJldGFpblVudGlsRGF0ZSIsImdldE9iamVjdExvY2tDb25maWciLCJwYXJzZU9iamVjdExvY2tDb25maWciLCJzZXRPYmplY3RMb2NrQ29uZmlnIiwibG9ja0NvbmZpZ09wdHMiLCJyZXRlbnRpb25Nb2RlcyIsInZhbGlkVW5pdHMiLCJEQVlTIiwiWUVBUlMiLCJ1bml0IiwidmFsaWRpdHkiLCJPYmplY3RMb2NrRW5hYmxlZCIsImNvbmZpZ0tleXMiLCJpc0FsbEtleXNTZXQiLCJldmVyeSIsImxjayIsIkRlZmF1bHRSZXRlbnRpb24iLCJEYXlzIiwiWWVhcnMiLCJnZXRCdWNrZXRWZXJzaW9uaW5nIiwicGFyc2VCdWNrZXRWZXJzaW9uaW5nQ29uZmlnIiwic2V0QnVja2V0VmVyc2lvbmluZyIsInZlcnNpb25Db25maWciLCJzZXRUYWdnaW5nIiwidGFnZ2luZ1BhcmFtcyIsInRhZ3MiLCJwdXRPcHRzIiwidGFnc0xpc3QiLCJ2YWx1ZSIsIktleSIsIlZhbHVlIiwidGFnZ2luZ0NvbmZpZyIsIlRhZ2dpbmciLCJUYWdTZXQiLCJUYWciLCJwYXlsb2FkQnVmIiwicmVtb3ZlVGFnZ2luZyIsInNldEJ1Y2tldFRhZ2dpbmciLCJyZW1vdmVCdWNrZXRUYWdnaW5nIiwic2V0T2JqZWN0VGFnZ2luZyIsInJlbW92ZU9iamVjdFRhZ2dpbmciLCJzZWxlY3RPYmplY3RDb250ZW50Iiwic2VsZWN0T3B0cyIsImV4cHJlc3Npb24iLCJpbnB1dFNlcmlhbGl6YXRpb24iLCJvdXRwdXRTZXJpYWxpemF0aW9uIiwiRXhwcmVzc2lvbiIsIkV4cHJlc3Npb25UeXBlIiwiZXhwcmVzc2lvblR5cGUiLCJJbnB1dFNlcmlhbGl6YXRpb24iLCJPdXRwdXRTZXJpYWxpemF0aW9uIiwicmVxdWVzdFByb2dyZXNzIiwiUmVxdWVzdFByb2dyZXNzIiwic2NhblJhbmdlIiwiU2NhblJhbmdlIiwiYXBwbHlCdWNrZXRMaWZlY3ljbGUiLCJwb2xpY3lDb25maWciLCJyZW1vdmVCdWNrZXRMaWZlY3ljbGUiLCJzZXRCdWNrZXRMaWZlY3ljbGUiLCJsaWZlQ3ljbGVDb25maWciLCJnZXRCdWNrZXRMaWZlY3ljbGUiLCJwYXJzZUxpZmVjeWNsZUNvbmZpZyIsInNldEJ1Y2tldEVuY3J5cHRpb24iLCJlbmNyeXB0aW9uQ29uZmlnIiwiZW5jcnlwdGlvbk9iaiIsIkFwcGx5U2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQiLCJTU0VBbGdvcml0aG0iLCJnZXRCdWNrZXRFbmNyeXB0aW9uIiwicGFyc2VCdWNrZXRFbmNyeXB0aW9uQ29uZmlnIiwicmVtb3ZlQnVja2V0RW5jcnlwdGlvbiIsImdldE9iamVjdFJldGVudGlvbiIsInBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnIiwicmVtb3ZlT2JqZWN0cyIsIm9iamVjdHNMaXN0IiwiQXJyYXkiLCJpc0FycmF5IiwicnVuRGVsZXRlT2JqZWN0cyIsImJhdGNoIiwiZGVsT2JqZWN0cyIsIlZlcnNpb25JZCIsInJlbU9iamVjdHMiLCJEZWxldGUiLCJRdWlldCIsInJlbW92ZU9iamVjdHNQYXJzZXIiLCJtYXhFbnRyaWVzIiwiYmF0Y2hlcyIsImkiLCJzbGljZSIsImJhdGNoUmVzdWx0cyIsImZsYXQiLCJyZW1vdmVJbmNvbXBsZXRlVXBsb2FkIiwiSXNWYWxpZEJ1Y2tldE5hbWVFcnJvciIsInJlbW92ZVVwbG9hZElkIiwiY29weU9iamVjdFYxIiwidGFyZ2V0QnVja2V0TmFtZSIsInRhcmdldE9iamVjdE5hbWUiLCJzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSIsImNvbmRpdGlvbnMiLCJtb2RpZmllZCIsInVubW9kaWZpZWQiLCJtYXRjaEVUYWciLCJtYXRjaEVUYWdFeGNlcHQiLCJwYXJzZUNvcHlPYmplY3QiLCJjb3B5T2JqZWN0VjIiLCJzb3VyY2VDb25maWciLCJkZXN0Q29uZmlnIiwidmFsaWRhdGUiLCJnZXRIZWFkZXJzIiwiQnVja2V0IiwiY29weVJlcyIsInJlc0hlYWRlcnMiLCJzaXplSGVhZGVyVmFsdWUiLCJMYXN0TW9kaWZpZWQiLCJNZXRhRGF0YSIsIlNvdXJjZVZlcnNpb25JZCIsIkV0YWciLCJTaXplIiwiY29weU9iamVjdCIsImFsbEFyZ3MiLCJzb3VyY2UiLCJkZXN0IiwidXBsb2FkUGFydCIsInBhcnRDb25maWciLCJ1cGxvYWRJRCIsInBhcnRSZXMiLCJjb21wb3NlT2JqZWN0IiwiZGVzdE9iakNvbmZpZyIsInNvdXJjZU9iakxpc3QiLCJzb3VyY2VGaWxlc0xlbmd0aCIsIk1BWF9QQVJUU19DT1VOVCIsInNPYmoiLCJnZXRTdGF0T3B0aW9ucyIsInNyY0NvbmZpZyIsIlZlcnNpb25JRCIsInNyY09iamVjdFNpemVzIiwidG90YWxTaXplIiwidG90YWxQYXJ0cyIsInNvdXJjZU9ialN0YXRzIiwic3JjSXRlbSIsInNyY09iamVjdEluZm9zIiwidmFsaWRhdGVkU3RhdHMiLCJyZXNJdGVtU3RhdCIsImluZGV4Iiwic3JjQ29weVNpemUiLCJNYXRjaFJhbmdlIiwic3JjU3RhcnQiLCJTdGFydCIsInNyY0VuZCIsIkVuZCIsIkFCU19NSU5fUEFSVF9TSVpFIiwiTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkUiLCJNQVhfUEFSVF9TSVpFIiwiTWF0Y2hFVGFnIiwic3BsaXRQYXJ0U2l6ZUxpc3QiLCJpZHgiLCJnZXRVcGxvYWRQYXJ0Q29uZmlnTGlzdCIsInVwbG9hZFBhcnRDb25maWdMaXN0Iiwic3BsaXRTaXplIiwic3BsaXRJbmRleCIsInN0YXJ0SW5kZXgiLCJzdGFydElkeCIsImVuZEluZGV4IiwiZW5kSWR4Iiwib2JqSW5mbyIsIm9iakNvbmZpZyIsInBhcnRJbmRleCIsInRvdGFsVXBsb2FkcyIsInNwbGl0U3RhcnQiLCJ1cGxkQ3RySWR4Iiwic3BsaXRFbmQiLCJzb3VyY2VPYmoiLCJ1cGxvYWRQYXJ0Q29uZmlnIiwidXBsb2FkQWxsUGFydHMiLCJ1cGxvYWRMaXN0IiwicGFydFVwbG9hZHMiLCJwZXJmb3JtVXBsb2FkUGFydHMiLCJwYXJ0c1JlcyIsInBhcnRDb3B5IiwibmV3VXBsb2FkSGVhZGVycyIsInBhcnRzRG9uZSIsInByZXNpZ25lZFVybCIsImV4cGlyZXMiLCJyZXFQYXJhbXMiLCJyZXF1ZXN0RGF0ZSIsIl9yZXF1ZXN0RGF0ZSIsIkFub255bW91c1JlcXVlc3RFcnJvciIsImlzTmFOIiwicHJlc2lnbmVkR2V0T2JqZWN0IiwicmVzcEhlYWRlcnMiLCJ2YWxpZFJlc3BIZWFkZXJzIiwiaGVhZGVyIiwicHJlc2lnbmVkUHV0T2JqZWN0IiwibmV3UG9zdFBvbGljeSIsInByZXNpZ25lZFBvc3RQb2xpY3kiLCJwb3N0UG9saWN5IiwiZm9ybURhdGEiLCJkYXRlU3RyIiwiZXhwaXJhdGlvbiIsInNldFNlY29uZHMiLCJzZXRFeHBpcmVzIiwicG9saWN5QmFzZTY0IiwicG9ydFN0ciIsInVybFN0ciIsInBvc3RVUkwiLCJlciJdLCJzb3VyY2VzIjpbImNsaWVudC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjcnlwdG8gZnJvbSAnbm9kZTpjcnlwdG8nXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJ1xuaW1wb3J0IHR5cGUgeyBJbmNvbWluZ0h0dHBIZWFkZXJzIH0gZnJvbSAnbm9kZTpodHRwJ1xuaW1wb3J0ICogYXMgaHR0cCBmcm9tICdub2RlOmh0dHAnXG5pbXBvcnQgKiBhcyBodHRwcyBmcm9tICdub2RlOmh0dHBzJ1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdub2RlOnBhdGgnXG5pbXBvcnQgKiBhcyBzdHJlYW0gZnJvbSAnbm9kZTpzdHJlYW0nXG5cbmltcG9ydCAqIGFzIGFzeW5jIGZyb20gJ2FzeW5jJ1xuaW1wb3J0IEJsb2NrU3RyZWFtMiBmcm9tICdibG9jay1zdHJlYW0yJ1xuaW1wb3J0IHsgaXNCcm93c2VyIH0gZnJvbSAnYnJvd3Nlci1vci1ub2RlJ1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJ1xuaW1wb3J0ICogYXMgcXMgZnJvbSAncXVlcnktc3RyaW5nJ1xuaW1wb3J0IHhtbDJqcyBmcm9tICd4bWwyanMnXG5cbmltcG9ydCB7IENyZWRlbnRpYWxQcm92aWRlciB9IGZyb20gJy4uL0NyZWRlbnRpYWxQcm92aWRlci50cydcbmltcG9ydCAqIGFzIGVycm9ycyBmcm9tICcuLi9lcnJvcnMudHMnXG5pbXBvcnQgdHlwZSB7IFNlbGVjdFJlc3VsdHMgfSBmcm9tICcuLi9oZWxwZXJzLnRzJ1xuaW1wb3J0IHtcbiAgQ29weURlc3RpbmF0aW9uT3B0aW9ucyxcbiAgQ29weVNvdXJjZU9wdGlvbnMsXG4gIERFRkFVTFRfUkVHSU9OLFxuICBMRUdBTF9IT0xEX1NUQVRVUyxcbiAgUFJFU0lHTl9FWFBJUllfREFZU19NQVgsXG4gIFJFVEVOVElPTl9NT0RFUyxcbiAgUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLFxufSBmcm9tICcuLi9oZWxwZXJzLnRzJ1xuaW1wb3J0IHR5cGUgeyBQb3N0UG9saWN5UmVzdWx0IH0gZnJvbSAnLi4vbWluaW8nXG5pbXBvcnQgeyBwb3N0UHJlc2lnblNpZ25hdHVyZVY0LCBwcmVzaWduU2lnbmF0dXJlVjQsIHNpZ25WNCB9IGZyb20gJy4uL3NpZ25pbmcudHMnXG5pbXBvcnQgeyBmc3AsIHN0cmVhbVByb21pc2UgfSBmcm9tICcuL2FzeW5jLnRzJ1xuaW1wb3J0IHsgQ29weUNvbmRpdGlvbnMgfSBmcm9tICcuL2NvcHktY29uZGl0aW9ucy50cydcbmltcG9ydCB7IEV4dGVuc2lvbnMgfSBmcm9tICcuL2V4dGVuc2lvbnMudHMnXG5pbXBvcnQge1xuICBjYWxjdWxhdGVFdmVuU3BsaXRzLFxuICBleHRyYWN0TWV0YWRhdGEsXG4gIGdldENvbnRlbnRMZW5ndGgsXG4gIGdldFNjb3BlLFxuICBnZXRTb3VyY2VWZXJzaW9uSWQsXG4gIGdldFZlcnNpb25JZCxcbiAgaGFzaEJpbmFyeSxcbiAgaW5zZXJ0Q29udGVudFR5cGUsXG4gIGlzQW1hem9uRW5kcG9pbnQsXG4gIGlzQm9vbGVhbixcbiAgaXNEZWZpbmVkLFxuICBpc0VtcHR5LFxuICBpc051bWJlcixcbiAgaXNPYmplY3QsXG4gIGlzUmVhZGFibGVTdHJlYW0sXG4gIGlzU3RyaW5nLFxuICBpc1ZhbGlkQnVja2V0TmFtZSxcbiAgaXNWYWxpZEVuZHBvaW50LFxuICBpc1ZhbGlkT2JqZWN0TmFtZSxcbiAgaXNWYWxpZFBvcnQsXG4gIGlzVmFsaWRQcmVmaXgsXG4gIGlzVmlydHVhbEhvc3RTdHlsZSxcbiAgbWFrZURhdGVMb25nLFxuICBQQVJUX0NPTlNUUkFJTlRTLFxuICBwYXJ0c1JlcXVpcmVkLFxuICBwcmVwZW5kWEFNWk1ldGEsXG4gIHJlYWRhYmxlU3RyZWFtLFxuICBzYW5pdGl6ZUVUYWcsXG4gIHRvTWQ1LFxuICB0b1NoYTI1NixcbiAgdXJpRXNjYXBlLFxuICB1cmlSZXNvdXJjZUVzY2FwZSxcbn0gZnJvbSAnLi9oZWxwZXIudHMnXG5pbXBvcnQgeyBqb2luSG9zdFBvcnQgfSBmcm9tICcuL2pvaW4taG9zdC1wb3J0LnRzJ1xuaW1wb3J0IHsgUG9zdFBvbGljeSB9IGZyb20gJy4vcG9zdC1wb2xpY3kudHMnXG5pbXBvcnQgeyByZXF1ZXN0IH0gZnJvbSAnLi9yZXF1ZXN0LnRzJ1xuaW1wb3J0IHsgZHJhaW5SZXNwb25zZSwgcmVhZEFzQnVmZmVyLCByZWFkQXNTdHJpbmcgfSBmcm9tICcuL3Jlc3BvbnNlLnRzJ1xuaW1wb3J0IHR5cGUgeyBSZWdpb24gfSBmcm9tICcuL3MzLWVuZHBvaW50cy50cydcbmltcG9ydCB7IGdldFMzRW5kcG9pbnQgfSBmcm9tICcuL3MzLWVuZHBvaW50cy50cydcbmltcG9ydCB0eXBlIHtcbiAgQmluYXJ5LFxuICBCdWNrZXRJdGVtRnJvbUxpc3QsXG4gIEJ1Y2tldEl0ZW1TdGF0LFxuICBCdWNrZXRTdHJlYW0sXG4gIEJ1Y2tldFZlcnNpb25pbmdDb25maWd1cmF0aW9uLFxuICBDb3B5T2JqZWN0UGFyYW1zLFxuICBDb3B5T2JqZWN0UmVzdWx0LFxuICBDb3B5T2JqZWN0UmVzdWx0VjIsXG4gIEVuY3J5cHRpb25Db25maWcsXG4gIEdldE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXG4gIEdldE9iamVjdE9wdHMsXG4gIEdldE9iamVjdFJldGVudGlvbk9wdHMsXG4gIEluY29tcGxldGVVcGxvYWRlZEJ1Y2tldEl0ZW0sXG4gIElSZXF1ZXN0LFxuICBJdGVtQnVja2V0TWV0YWRhdGEsXG4gIExpZmVjeWNsZUNvbmZpZyxcbiAgTGlmZUN5Y2xlQ29uZmlnUGFyYW0sXG4gIE9iamVjdExvY2tDb25maWdQYXJhbSxcbiAgT2JqZWN0TG9ja0luZm8sXG4gIE9iamVjdE1ldGFEYXRhLFxuICBPYmplY3RSZXRlbnRpb25JbmZvLFxuICBQcmVTaWduUmVxdWVzdFBhcmFtcyxcbiAgUHV0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgUHV0VGFnZ2luZ1BhcmFtcyxcbiAgUmVtb3ZlT2JqZWN0c1BhcmFtLFxuICBSZW1vdmVPYmplY3RzUmVxdWVzdEVudHJ5LFxuICBSZW1vdmVPYmplY3RzUmVzcG9uc2UsXG4gIFJlbW92ZVRhZ2dpbmdQYXJhbXMsXG4gIFJlcGxpY2F0aW9uQ29uZmlnLFxuICBSZXBsaWNhdGlvbkNvbmZpZ09wdHMsXG4gIFJlcXVlc3RIZWFkZXJzLFxuICBSZXNwb25zZUhlYWRlcixcbiAgUmVzdWx0Q2FsbGJhY2ssXG4gIFJldGVudGlvbixcbiAgU2VsZWN0T3B0aW9ucyxcbiAgU3RhdE9iamVjdE9wdHMsXG4gIFRhZyxcbiAgVGFnZ2luZ09wdHMsXG4gIFRhZ3MsXG4gIFRyYW5zcG9ydCxcbiAgVXBsb2FkZWRPYmplY3RJbmZvLFxuICBVcGxvYWRQYXJ0Q29uZmlnLFxufSBmcm9tICcuL3R5cGUudHMnXG5pbXBvcnQgdHlwZSB7IExpc3RNdWx0aXBhcnRSZXN1bHQsIFVwbG9hZGVkUGFydCB9IGZyb20gJy4veG1sLXBhcnNlci50cydcbmltcG9ydCAqIGFzIHhtbFBhcnNlcnMgZnJvbSAnLi94bWwtcGFyc2VyLnRzJ1xuaW1wb3J0IHtcbiAgcGFyc2VDb21wbGV0ZU11bHRpcGFydCxcbiAgcGFyc2VJbml0aWF0ZU11bHRpcGFydCxcbiAgcGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWcsXG4gIHBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlLFxuICB1cGxvYWRQYXJ0UGFyc2VyLFxufSBmcm9tICcuL3htbC1wYXJzZXIudHMnXG5cbmNvbnN0IHhtbCA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxuXG4vLyB3aWxsIGJlIHJlcGxhY2VkIGJ5IGJ1bmRsZXIuXG5jb25zdCBQYWNrYWdlID0geyB2ZXJzaW9uOiBwcm9jZXNzLmVudi5NSU5JT19KU19QQUNLQUdFX1ZFUlNJT04gfHwgJ2RldmVsb3BtZW50JyB9XG5cbmNvbnN0IHJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzID0gW1xuICAnYWdlbnQnLFxuICAnY2EnLFxuICAnY2VydCcsXG4gICdjaXBoZXJzJyxcbiAgJ2NsaWVudENlcnRFbmdpbmUnLFxuICAnY3JsJyxcbiAgJ2RocGFyYW0nLFxuICAnZWNkaEN1cnZlJyxcbiAgJ2ZhbWlseScsXG4gICdob25vckNpcGhlck9yZGVyJyxcbiAgJ2tleScsXG4gICdwYXNzcGhyYXNlJyxcbiAgJ3BmeCcsXG4gICdyZWplY3RVbmF1dGhvcml6ZWQnLFxuICAnc2VjdXJlT3B0aW9ucycsXG4gICdzZWN1cmVQcm90b2NvbCcsXG4gICdzZXJ2ZXJuYW1lJyxcbiAgJ3Nlc3Npb25JZENvbnRleHQnLFxuXSBhcyBjb25zdFxuXG5leHBvcnQgaW50ZXJmYWNlIENsaWVudE9wdGlvbnMge1xuICBlbmRQb2ludDogc3RyaW5nXG4gIGFjY2Vzc0tleTogc3RyaW5nXG4gIHNlY3JldEtleTogc3RyaW5nXG4gIHVzZVNTTD86IGJvb2xlYW5cbiAgcG9ydD86IG51bWJlclxuICByZWdpb24/OiBSZWdpb25cbiAgdHJhbnNwb3J0PzogVHJhbnNwb3J0XG4gIHNlc3Npb25Ub2tlbj86IHN0cmluZ1xuICBwYXJ0U2l6ZT86IG51bWJlclxuICBwYXRoU3R5bGU/OiBib29sZWFuXG4gIGNyZWRlbnRpYWxzUHJvdmlkZXI/OiBDcmVkZW50aWFsUHJvdmlkZXJcbiAgczNBY2NlbGVyYXRlRW5kcG9pbnQ/OiBzdHJpbmdcbiAgdHJhbnNwb3J0QWdlbnQ/OiBodHRwLkFnZW50XG59XG5cbmV4cG9ydCB0eXBlIFJlcXVlc3RPcHRpb24gPSBQYXJ0aWFsPElSZXF1ZXN0PiAmIHtcbiAgbWV0aG9kOiBzdHJpbmdcbiAgYnVja2V0TmFtZT86IHN0cmluZ1xuICBvYmplY3ROYW1lPzogc3RyaW5nXG4gIHF1ZXJ5Pzogc3RyaW5nXG4gIHBhdGhTdHlsZT86IGJvb2xlYW5cbn1cblxuZXhwb3J0IHR5cGUgTm9SZXN1bHRDYWxsYmFjayA9IChlcnJvcjogdW5rbm93bikgPT4gdm9pZFxuXG5leHBvcnQgaW50ZXJmYWNlIE1ha2VCdWNrZXRPcHQge1xuICBPYmplY3RMb2NraW5nPzogYm9vbGVhblxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlbW92ZU9wdGlvbnMge1xuICB2ZXJzaW9uSWQ/OiBzdHJpbmdcbiAgZ292ZXJuYW5jZUJ5cGFzcz86IGJvb2xlYW5cbiAgZm9yY2VEZWxldGU/OiBib29sZWFuXG59XG5cbnR5cGUgUGFydCA9IHtcbiAgcGFydDogbnVtYmVyXG4gIGV0YWc6IHN0cmluZ1xufVxuXG5leHBvcnQgY2xhc3MgVHlwZWRDbGllbnQge1xuICBwcm90ZWN0ZWQgdHJhbnNwb3J0OiBUcmFuc3BvcnRcbiAgcHJvdGVjdGVkIGhvc3Q6IHN0cmluZ1xuICBwcm90ZWN0ZWQgcG9ydDogbnVtYmVyXG4gIHByb3RlY3RlZCBwcm90b2NvbDogc3RyaW5nXG4gIHByb3RlY3RlZCBhY2Nlc3NLZXk6IHN0cmluZ1xuICBwcm90ZWN0ZWQgc2VjcmV0S2V5OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHNlc3Npb25Ub2tlbj86IHN0cmluZ1xuICBwcm90ZWN0ZWQgdXNlckFnZW50OiBzdHJpbmdcbiAgcHJvdGVjdGVkIGFub255bW91czogYm9vbGVhblxuICBwcm90ZWN0ZWQgcGF0aFN0eWxlOiBib29sZWFuXG4gIHByb3RlY3RlZCByZWdpb25NYXA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbiAgcHVibGljIHJlZ2lvbj86IHN0cmluZ1xuICBwcm90ZWN0ZWQgY3JlZGVudGlhbHNQcm92aWRlcj86IENyZWRlbnRpYWxQcm92aWRlclxuICBwYXJ0U2l6ZTogbnVtYmVyID0gNjQgKiAxMDI0ICogMTAyNFxuICBwcm90ZWN0ZWQgb3ZlclJpZGVQYXJ0U2l6ZT86IGJvb2xlYW5cblxuICBwcm90ZWN0ZWQgbWF4aW11bVBhcnRTaXplID0gNSAqIDEwMjQgKiAxMDI0ICogMTAyNFxuICBwcm90ZWN0ZWQgbWF4T2JqZWN0U2l6ZSA9IDUgKiAxMDI0ICogMTAyNCAqIDEwMjQgKiAxMDI0XG4gIHB1YmxpYyBlbmFibGVTSEEyNTY6IGJvb2xlYW5cbiAgcHJvdGVjdGVkIHMzQWNjZWxlcmF0ZUVuZHBvaW50Pzogc3RyaW5nXG4gIHByb3RlY3RlZCByZXFPcHRpb25zOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuXG4gIHByb3RlY3RlZCB0cmFuc3BvcnRBZ2VudDogaHR0cC5BZ2VudFxuICBwcml2YXRlIHJlYWRvbmx5IGNsaWVudEV4dGVuc2lvbnM6IEV4dGVuc2lvbnNcblxuICBjb25zdHJ1Y3RvcihwYXJhbXM6IENsaWVudE9wdGlvbnMpIHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGRlcHJlY2F0ZWQgcHJvcGVydHlcbiAgICBpZiAocGFyYW1zLnNlY3VyZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1wic2VjdXJlXCIgb3B0aW9uIGRlcHJlY2F0ZWQsIFwidXNlU1NMXCIgc2hvdWxkIGJlIHVzZWQgaW5zdGVhZCcpXG4gICAgfVxuICAgIC8vIERlZmF1bHQgdmFsdWVzIGlmIG5vdCBzcGVjaWZpZWQuXG4gICAgaWYgKHBhcmFtcy51c2VTU0wgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcGFyYW1zLnVzZVNTTCA9IHRydWVcbiAgICB9XG4gICAgaWYgKCFwYXJhbXMucG9ydCkge1xuICAgICAgcGFyYW1zLnBvcnQgPSAwXG4gICAgfVxuICAgIC8vIFZhbGlkYXRlIGlucHV0IHBhcmFtcy5cbiAgICBpZiAoIWlzVmFsaWRFbmRwb2ludChwYXJhbXMuZW5kUG9pbnQpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRFbmRwb2ludEVycm9yKGBJbnZhbGlkIGVuZFBvaW50IDogJHtwYXJhbXMuZW5kUG9pbnR9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkUG9ydChwYXJhbXMucG9ydCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgcG9ydCA6ICR7cGFyYW1zLnBvcnR9YClcbiAgICB9XG4gICAgaWYgKCFpc0Jvb2xlYW4ocGFyYW1zLnVzZVNTTCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgIGBJbnZhbGlkIHVzZVNTTCBmbGFnIHR5cGUgOiAke3BhcmFtcy51c2VTU0x9LCBleHBlY3RlZCB0byBiZSBvZiB0eXBlIFwiYm9vbGVhblwiYCxcbiAgICAgIClcbiAgICB9XG5cbiAgICAvLyBWYWxpZGF0ZSByZWdpb24gb25seSBpZiBpdHMgc2V0LlxuICAgIGlmIChwYXJhbXMucmVnaW9uKSB7XG4gICAgICBpZiAoIWlzU3RyaW5nKHBhcmFtcy5yZWdpb24pKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgcmVnaW9uIDogJHtwYXJhbXMucmVnaW9ufWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgaG9zdCA9IHBhcmFtcy5lbmRQb2ludC50b0xvd2VyQ2FzZSgpXG4gICAgbGV0IHBvcnQgPSBwYXJhbXMucG9ydFxuICAgIGxldCBwcm90b2NvbDogc3RyaW5nXG4gICAgbGV0IHRyYW5zcG9ydFxuICAgIGxldCB0cmFuc3BvcnRBZ2VudDogaHR0cC5BZ2VudFxuICAgIC8vIFZhbGlkYXRlIGlmIGNvbmZpZ3VyYXRpb24gaXMgbm90IHVzaW5nIFNTTFxuICAgIC8vIGZvciBjb25zdHJ1Y3RpbmcgcmVsZXZhbnQgZW5kcG9pbnRzLlxuICAgIGlmIChwYXJhbXMudXNlU1NMKSB7XG4gICAgICAvLyBEZWZhdWx0cyB0byBzZWN1cmUuXG4gICAgICB0cmFuc3BvcnQgPSBodHRwc1xuICAgICAgcHJvdG9jb2wgPSAnaHR0cHM6J1xuICAgICAgcG9ydCA9IHBvcnQgfHwgNDQzXG4gICAgICB0cmFuc3BvcnRBZ2VudCA9IGh0dHBzLmdsb2JhbEFnZW50XG4gICAgfSBlbHNlIHtcbiAgICAgIHRyYW5zcG9ydCA9IGh0dHBcbiAgICAgIHByb3RvY29sID0gJ2h0dHA6J1xuICAgICAgcG9ydCA9IHBvcnQgfHwgODBcbiAgICAgIHRyYW5zcG9ydEFnZW50ID0gaHR0cC5nbG9iYWxBZ2VudFxuICAgIH1cblxuICAgIC8vIGlmIGN1c3RvbSB0cmFuc3BvcnQgaXMgc2V0LCB1c2UgaXQuXG4gICAgaWYgKHBhcmFtcy50cmFuc3BvcnQpIHtcbiAgICAgIGlmICghaXNPYmplY3QocGFyYW1zLnRyYW5zcG9ydCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICBgSW52YWxpZCB0cmFuc3BvcnQgdHlwZSA6ICR7cGFyYW1zLnRyYW5zcG9ydH0sIGV4cGVjdGVkIHRvIGJlIHR5cGUgXCJvYmplY3RcImAsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICAgIHRyYW5zcG9ydCA9IHBhcmFtcy50cmFuc3BvcnRcbiAgICB9XG5cbiAgICAvLyBpZiBjdXN0b20gdHJhbnNwb3J0IGFnZW50IGlzIHNldCwgdXNlIGl0LlxuICAgIGlmIChwYXJhbXMudHJhbnNwb3J0QWdlbnQpIHtcbiAgICAgIGlmICghaXNPYmplY3QocGFyYW1zLnRyYW5zcG9ydEFnZW50KSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgIGBJbnZhbGlkIHRyYW5zcG9ydEFnZW50IHR5cGU6ICR7cGFyYW1zLnRyYW5zcG9ydEFnZW50fSwgZXhwZWN0ZWQgdG8gYmUgdHlwZSBcIm9iamVjdFwiYCxcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICB0cmFuc3BvcnRBZ2VudCA9IHBhcmFtcy50cmFuc3BvcnRBZ2VudFxuICAgIH1cblxuICAgIC8vIFVzZXIgQWdlbnQgc2hvdWxkIGFsd2F5cyBmb2xsb3dpbmcgdGhlIGJlbG93IHN0eWxlLlxuICAgIC8vIFBsZWFzZSBvcGVuIGFuIGlzc3VlIHRvIGRpc2N1c3MgYW55IG5ldyBjaGFuZ2VzIGhlcmUuXG4gICAgLy9cbiAgICAvLyAgICAgICBNaW5JTyAoT1M7IEFSQ0gpIExJQi9WRVIgQVBQL1ZFUlxuICAgIC8vXG4gICAgY29uc3QgbGlicmFyeUNvbW1lbnRzID0gYCgke3Byb2Nlc3MucGxhdGZvcm19OyAke3Byb2Nlc3MuYXJjaH0pYFxuICAgIGNvbnN0IGxpYnJhcnlBZ2VudCA9IGBNaW5JTyAke2xpYnJhcnlDb21tZW50c30gbWluaW8tanMvJHtQYWNrYWdlLnZlcnNpb259YFxuICAgIC8vIFVzZXIgYWdlbnQgYmxvY2sgZW5kcy5cblxuICAgIHRoaXMudHJhbnNwb3J0ID0gdHJhbnNwb3J0XG4gICAgdGhpcy50cmFuc3BvcnRBZ2VudCA9IHRyYW5zcG9ydEFnZW50XG4gICAgdGhpcy5ob3N0ID0gaG9zdFxuICAgIHRoaXMucG9ydCA9IHBvcnRcbiAgICB0aGlzLnByb3RvY29sID0gcHJvdG9jb2xcbiAgICB0aGlzLnVzZXJBZ2VudCA9IGAke2xpYnJhcnlBZ2VudH1gXG5cbiAgICAvLyBEZWZhdWx0IHBhdGggc3R5bGUgaXMgdHJ1ZVxuICAgIGlmIChwYXJhbXMucGF0aFN0eWxlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMucGF0aFN0eWxlID0gdHJ1ZVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnBhdGhTdHlsZSA9IHBhcmFtcy5wYXRoU3R5bGVcbiAgICB9XG5cbiAgICB0aGlzLmFjY2Vzc0tleSA9IHBhcmFtcy5hY2Nlc3NLZXkgPz8gJydcbiAgICB0aGlzLnNlY3JldEtleSA9IHBhcmFtcy5zZWNyZXRLZXkgPz8gJydcbiAgICB0aGlzLnNlc3Npb25Ub2tlbiA9IHBhcmFtcy5zZXNzaW9uVG9rZW5cbiAgICB0aGlzLmFub255bW91cyA9ICF0aGlzLmFjY2Vzc0tleSB8fCAhdGhpcy5zZWNyZXRLZXlcblxuICAgIGlmIChwYXJhbXMuY3JlZGVudGlhbHNQcm92aWRlcikge1xuICAgICAgdGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyID0gcGFyYW1zLmNyZWRlbnRpYWxzUHJvdmlkZXJcbiAgICB9XG5cbiAgICB0aGlzLnJlZ2lvbk1hcCA9IHt9XG4gICAgaWYgKHBhcmFtcy5yZWdpb24pIHtcbiAgICAgIHRoaXMucmVnaW9uID0gcGFyYW1zLnJlZ2lvblxuICAgIH1cblxuICAgIGlmIChwYXJhbXMucGFydFNpemUpIHtcbiAgICAgIHRoaXMucGFydFNpemUgPSBwYXJhbXMucGFydFNpemVcbiAgICAgIHRoaXMub3ZlclJpZGVQYXJ0U2l6ZSA9IHRydWVcbiAgICB9XG4gICAgaWYgKHRoaXMucGFydFNpemUgPCA1ICogMTAyNCAqIDEwMjQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYFBhcnQgc2l6ZSBzaG91bGQgYmUgZ3JlYXRlciB0aGFuIDVNQmApXG4gICAgfVxuICAgIGlmICh0aGlzLnBhcnRTaXplID4gNSAqIDEwMjQgKiAxMDI0ICogMTAyNCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgUGFydCBzaXplIHNob3VsZCBiZSBsZXNzIHRoYW4gNUdCYClcbiAgICB9XG5cbiAgICAvLyBTSEEyNTYgaXMgZW5hYmxlZCBvbmx5IGZvciBhdXRoZW50aWNhdGVkIGh0dHAgcmVxdWVzdHMuIElmIHRoZSByZXF1ZXN0IGlzIGF1dGhlbnRpY2F0ZWRcbiAgICAvLyBhbmQgdGhlIGNvbm5lY3Rpb24gaXMgaHR0cHMgd2UgdXNlIHgtYW16LWNvbnRlbnQtc2hhMjU2PVVOU0lHTkVELVBBWUxPQURcbiAgICAvLyBoZWFkZXIgZm9yIHNpZ25hdHVyZSBjYWxjdWxhdGlvbi5cbiAgICB0aGlzLmVuYWJsZVNIQTI1NiA9ICF0aGlzLmFub255bW91cyAmJiAhcGFyYW1zLnVzZVNTTFxuXG4gICAgdGhpcy5zM0FjY2VsZXJhdGVFbmRwb2ludCA9IHBhcmFtcy5zM0FjY2VsZXJhdGVFbmRwb2ludCB8fCB1bmRlZmluZWRcbiAgICB0aGlzLnJlcU9wdGlvbnMgPSB7fVxuICAgIHRoaXMuY2xpZW50RXh0ZW5zaW9ucyA9IG5ldyBFeHRlbnNpb25zKHRoaXMpXG4gIH1cbiAgLyoqXG4gICAqIE1pbmlvIGV4dGVuc2lvbnMgdGhhdCBhcmVuJ3QgbmVjZXNzYXJ5IHByZXNlbnQgZm9yIEFtYXpvbiBTMyBjb21wYXRpYmxlIHN0b3JhZ2Ugc2VydmVyc1xuICAgKi9cbiAgZ2V0IGV4dGVuc2lvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuY2xpZW50RXh0ZW5zaW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIEBwYXJhbSBlbmRQb2ludCAtIHZhbGlkIFMzIGFjY2VsZXJhdGlvbiBlbmQgcG9pbnRcbiAgICovXG4gIHNldFMzVHJhbnNmZXJBY2NlbGVyYXRlKGVuZFBvaW50OiBzdHJpbmcpIHtcbiAgICB0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50ID0gZW5kUG9pbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBzdXBwb3J0ZWQgcmVxdWVzdCBvcHRpb25zLlxuICAgKi9cbiAgcHVibGljIHNldFJlcXVlc3RPcHRpb25zKG9wdGlvbnM6IFBpY2s8aHR0cHMuUmVxdWVzdE9wdGlvbnMsICh0eXBlb2YgcmVxdWVzdE9wdGlvblByb3BlcnRpZXMpW251bWJlcl0+KSB7XG4gICAgaWYgKCFpc09iamVjdChvcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxdWVzdCBvcHRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICB0aGlzLnJlcU9wdGlvbnMgPSBfLnBpY2sob3B0aW9ucywgcmVxdWVzdE9wdGlvblByb3BlcnRpZXMpXG4gIH1cblxuICAvKipcbiAgICogIFRoaXMgaXMgczMgU3BlY2lmaWMgYW5kIGRvZXMgbm90IGhvbGQgdmFsaWRpdHkgaW4gYW55IG90aGVyIE9iamVjdCBzdG9yYWdlLlxuICAgKi9cbiAgcHJpdmF0ZSBnZXRBY2NlbGVyYXRlRW5kUG9pbnRJZlNldChidWNrZXROYW1lPzogc3RyaW5nLCBvYmplY3ROYW1lPzogc3RyaW5nKSB7XG4gICAgaWYgKCFpc0VtcHR5KHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnQpICYmICFpc0VtcHR5KGJ1Y2tldE5hbWUpICYmICFpc0VtcHR5KG9iamVjdE5hbWUpKSB7XG4gICAgICAvLyBodHRwOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BbWF6b25TMy9sYXRlc3QvZGV2L3RyYW5zZmVyLWFjY2VsZXJhdGlvbi5odG1sXG4gICAgICAvLyBEaXNhYmxlIHRyYW5zZmVyIGFjY2VsZXJhdGlvbiBmb3Igbm9uLWNvbXBsaWFudCBidWNrZXQgbmFtZXMuXG4gICAgICBpZiAoYnVja2V0TmFtZS5pbmNsdWRlcygnLicpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVHJhbnNmZXIgQWNjZWxlcmF0aW9uIGlzIG5vdCBzdXBwb3J0ZWQgZm9yIG5vbiBjb21wbGlhbnQgYnVja2V0OiR7YnVja2V0TmFtZX1gKVxuICAgICAgfVxuICAgICAgLy8gSWYgdHJhbnNmZXIgYWNjZWxlcmF0aW9uIGlzIHJlcXVlc3RlZCBzZXQgbmV3IGhvc3QuXG4gICAgICAvLyBGb3IgbW9yZSBkZXRhaWxzIGFib3V0IGVuYWJsaW5nIHRyYW5zZmVyIGFjY2VsZXJhdGlvbiByZWFkIGhlcmUuXG4gICAgICAvLyBodHRwOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BbWF6b25TMy9sYXRlc3QvZGV2L3RyYW5zZmVyLWFjY2VsZXJhdGlvbi5odG1sXG4gICAgICByZXR1cm4gdGhpcy5zM0FjY2VsZXJhdGVFbmRwb2ludFxuICAgIH1cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiAgIFNldCBhcHBsaWNhdGlvbiBzcGVjaWZpYyBpbmZvcm1hdGlvbi5cbiAgICogICBHZW5lcmF0ZXMgVXNlci1BZ2VudCBpbiB0aGUgZm9sbG93aW5nIHN0eWxlLlxuICAgKiAgIE1pbklPIChPUzsgQVJDSCkgTElCL1ZFUiBBUFAvVkVSXG4gICAqL1xuICBzZXRBcHBJbmZvKGFwcE5hbWU6IHN0cmluZywgYXBwVmVyc2lvbjogc3RyaW5nKSB7XG4gICAgaWYgKCFpc1N0cmluZyhhcHBOYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCBhcHBOYW1lOiAke2FwcE5hbWV9YClcbiAgICB9XG4gICAgaWYgKGFwcE5hbWUudHJpbSgpID09PSAnJykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW5wdXQgYXBwTmFtZSBjYW5ub3QgYmUgZW1wdHkuJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhhcHBWZXJzaW9uKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCBhcHBWZXJzaW9uOiAke2FwcFZlcnNpb259YClcbiAgICB9XG4gICAgaWYgKGFwcFZlcnNpb24udHJpbSgpID09PSAnJykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW5wdXQgYXBwVmVyc2lvbiBjYW5ub3QgYmUgZW1wdHkuJylcbiAgICB9XG4gICAgdGhpcy51c2VyQWdlbnQgPSBgJHt0aGlzLnVzZXJBZ2VudH0gJHthcHBOYW1lfS8ke2FwcFZlcnNpb259YFxuICB9XG5cbiAgLyoqXG4gICAqIHJldHVybnMgb3B0aW9ucyBvYmplY3QgdGhhdCBjYW4gYmUgdXNlZCB3aXRoIGh0dHAucmVxdWVzdCgpXG4gICAqIFRha2VzIGNhcmUgb2YgY29uc3RydWN0aW5nIHZpcnR1YWwtaG9zdC1zdHlsZSBvciBwYXRoLXN0eWxlIGhvc3RuYW1lXG4gICAqL1xuICBwcm90ZWN0ZWQgZ2V0UmVxdWVzdE9wdGlvbnMoXG4gICAgb3B0czogUmVxdWVzdE9wdGlvbiAmIHtcbiAgICAgIHJlZ2lvbjogc3RyaW5nXG4gICAgfSxcbiAgKTogSVJlcXVlc3QgJiB7XG4gICAgaG9zdDogc3RyaW5nXG4gICAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuICB9IHtcbiAgICBjb25zdCBtZXRob2QgPSBvcHRzLm1ldGhvZFxuICAgIGNvbnN0IHJlZ2lvbiA9IG9wdHMucmVnaW9uXG4gICAgY29uc3QgYnVja2V0TmFtZSA9IG9wdHMuYnVja2V0TmFtZVxuICAgIGxldCBvYmplY3ROYW1lID0gb3B0cy5vYmplY3ROYW1lXG4gICAgY29uc3QgaGVhZGVycyA9IG9wdHMuaGVhZGVyc1xuICAgIGNvbnN0IHF1ZXJ5ID0gb3B0cy5xdWVyeVxuXG4gICAgbGV0IHJlcU9wdGlvbnMgPSB7XG4gICAgICBtZXRob2QsXG4gICAgICBoZWFkZXJzOiB7fSBhcyBSZXF1ZXN0SGVhZGVycyxcbiAgICAgIHByb3RvY29sOiB0aGlzLnByb3RvY29sLFxuICAgICAgLy8gSWYgY3VzdG9tIHRyYW5zcG9ydEFnZW50IHdhcyBzdXBwbGllZCBlYXJsaWVyLCB3ZSdsbCBpbmplY3QgaXQgaGVyZVxuICAgICAgYWdlbnQ6IHRoaXMudHJhbnNwb3J0QWdlbnQsXG4gICAgfVxuXG4gICAgLy8gVmVyaWZ5IGlmIHZpcnR1YWwgaG9zdCBzdXBwb3J0ZWQuXG4gICAgbGV0IHZpcnR1YWxIb3N0U3R5bGVcbiAgICBpZiAoYnVja2V0TmFtZSkge1xuICAgICAgdmlydHVhbEhvc3RTdHlsZSA9IGlzVmlydHVhbEhvc3RTdHlsZSh0aGlzLmhvc3QsIHRoaXMucHJvdG9jb2wsIGJ1Y2tldE5hbWUsIHRoaXMucGF0aFN0eWxlKVxuICAgIH1cblxuICAgIGxldCBwYXRoID0gJy8nXG4gICAgbGV0IGhvc3QgPSB0aGlzLmhvc3RcblxuICAgIGxldCBwb3J0OiB1bmRlZmluZWQgfCBudW1iZXJcbiAgICBpZiAodGhpcy5wb3J0KSB7XG4gICAgICBwb3J0ID0gdGhpcy5wb3J0XG4gICAgfVxuXG4gICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgIG9iamVjdE5hbWUgPSB1cmlSZXNvdXJjZUVzY2FwZShvYmplY3ROYW1lKVxuICAgIH1cblxuICAgIC8vIEZvciBBbWF6b24gUzMgZW5kcG9pbnQsIGdldCBlbmRwb2ludCBiYXNlZCBvbiByZWdpb24uXG4gICAgaWYgKGlzQW1hem9uRW5kcG9pbnQoaG9zdCkpIHtcbiAgICAgIGNvbnN0IGFjY2VsZXJhdGVFbmRQb2ludCA9IHRoaXMuZ2V0QWNjZWxlcmF0ZUVuZFBvaW50SWZTZXQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSlcbiAgICAgIGlmIChhY2NlbGVyYXRlRW5kUG9pbnQpIHtcbiAgICAgICAgaG9zdCA9IGAke2FjY2VsZXJhdGVFbmRQb2ludH1gXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBob3N0ID0gZ2V0UzNFbmRwb2ludChyZWdpb24pXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHZpcnR1YWxIb3N0U3R5bGUgJiYgIW9wdHMucGF0aFN0eWxlKSB7XG4gICAgICAvLyBGb3IgYWxsIGhvc3RzIHdoaWNoIHN1cHBvcnQgdmlydHVhbCBob3N0IHN0eWxlLCBgYnVja2V0TmFtZWBcbiAgICAgIC8vIGlzIHBhcnQgb2YgdGhlIGhvc3RuYW1lIGluIHRoZSBmb2xsb3dpbmcgZm9ybWF0OlxuICAgICAgLy9cbiAgICAgIC8vICB2YXIgaG9zdCA9ICdidWNrZXROYW1lLmV4YW1wbGUuY29tJ1xuICAgICAgLy9cbiAgICAgIGlmIChidWNrZXROYW1lKSB7XG4gICAgICAgIGhvc3QgPSBgJHtidWNrZXROYW1lfS4ke2hvc3R9YFxuICAgICAgfVxuICAgICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgICAgcGF0aCA9IGAvJHtvYmplY3ROYW1lfWBcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRm9yIGFsbCBTMyBjb21wYXRpYmxlIHN0b3JhZ2Ugc2VydmljZXMgd2Ugd2lsbCBmYWxsYmFjayB0b1xuICAgICAgLy8gcGF0aCBzdHlsZSByZXF1ZXN0cywgd2hlcmUgYGJ1Y2tldE5hbWVgIGlzIHBhcnQgb2YgdGhlIFVSSVxuICAgICAgLy8gcGF0aC5cbiAgICAgIGlmIChidWNrZXROYW1lKSB7XG4gICAgICAgIHBhdGggPSBgLyR7YnVja2V0TmFtZX1gXG4gICAgICB9XG4gICAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgICBwYXRoID0gYC8ke2J1Y2tldE5hbWV9LyR7b2JqZWN0TmFtZX1gXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHF1ZXJ5KSB7XG4gICAgICBwYXRoICs9IGA/JHtxdWVyeX1gXG4gICAgfVxuICAgIHJlcU9wdGlvbnMuaGVhZGVycy5ob3N0ID0gaG9zdFxuICAgIGlmICgocmVxT3B0aW9ucy5wcm90b2NvbCA9PT0gJ2h0dHA6JyAmJiBwb3J0ICE9PSA4MCkgfHwgKHJlcU9wdGlvbnMucHJvdG9jb2wgPT09ICdodHRwczonICYmIHBvcnQgIT09IDQ0MykpIHtcbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVycy5ob3N0ID0gam9pbkhvc3RQb3J0KGhvc3QsIHBvcnQpXG4gICAgfVxuXG4gICAgcmVxT3B0aW9ucy5oZWFkZXJzWyd1c2VyLWFnZW50J10gPSB0aGlzLnVzZXJBZ2VudFxuICAgIGlmIChoZWFkZXJzKSB7XG4gICAgICAvLyBoYXZlIGFsbCBoZWFkZXIga2V5cyBpbiBsb3dlciBjYXNlIC0gdG8gbWFrZSBzaWduaW5nIGVhc3lcbiAgICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKGhlYWRlcnMpKSB7XG4gICAgICAgIHJlcU9wdGlvbnMuaGVhZGVyc1trLnRvTG93ZXJDYXNlKCldID0gdlxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFVzZSBhbnkgcmVxdWVzdCBvcHRpb24gc3BlY2lmaWVkIGluIG1pbmlvQ2xpZW50LnNldFJlcXVlc3RPcHRpb25zKClcbiAgICByZXFPcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5yZXFPcHRpb25zLCByZXFPcHRpb25zKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnJlcU9wdGlvbnMsXG4gICAgICBoZWFkZXJzOiBfLm1hcFZhbHVlcyhfLnBpY2tCeShyZXFPcHRpb25zLmhlYWRlcnMsIGlzRGVmaW5lZCksICh2KSA9PiB2LnRvU3RyaW5nKCkpLFxuICAgICAgaG9zdCxcbiAgICAgIHBvcnQsXG4gICAgICBwYXRoLFxuICAgIH0gc2F0aXNmaWVzIGh0dHBzLlJlcXVlc3RPcHRpb25zXG4gIH1cblxuICBwdWJsaWMgYXN5bmMgc2V0Q3JlZGVudGlhbHNQcm92aWRlcihjcmVkZW50aWFsc1Byb3ZpZGVyOiBDcmVkZW50aWFsUHJvdmlkZXIpIHtcbiAgICBpZiAoIShjcmVkZW50aWFsc1Byb3ZpZGVyIGluc3RhbmNlb2YgQ3JlZGVudGlhbFByb3ZpZGVyKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmFibGUgdG8gZ2V0IGNyZWRlbnRpYWxzLiBFeHBlY3RlZCBpbnN0YW5jZSBvZiBDcmVkZW50aWFsUHJvdmlkZXInKVxuICAgIH1cbiAgICB0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIgPSBjcmVkZW50aWFsc1Byb3ZpZGVyXG4gICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNoZWNrQW5kUmVmcmVzaENyZWRzKCkge1xuICAgIGlmICh0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNyZWRlbnRpYWxzQ29uZiA9IGF3YWl0IHRoaXMuY3JlZGVudGlhbHNQcm92aWRlci5nZXRDcmVkZW50aWFscygpXG4gICAgICAgIHRoaXMuYWNjZXNzS2V5ID0gY3JlZGVudGlhbHNDb25mLmdldEFjY2Vzc0tleSgpXG4gICAgICAgIHRoaXMuc2VjcmV0S2V5ID0gY3JlZGVudGlhbHNDb25mLmdldFNlY3JldEtleSgpXG4gICAgICAgIHRoaXMuc2Vzc2lvblRva2VuID0gY3JlZGVudGlhbHNDb25mLmdldFNlc3Npb25Ub2tlbigpXG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGdldCBjcmVkZW50aWFsczogJHtlfWAsIHsgY2F1c2U6IGUgfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGxvZ1N0cmVhbT86IHN0cmVhbS5Xcml0YWJsZVxuXG4gIC8qKlxuICAgKiBsb2cgdGhlIHJlcXVlc3QsIHJlc3BvbnNlLCBlcnJvclxuICAgKi9cbiAgcHJpdmF0ZSBsb2dIVFRQKHJlcU9wdGlvbnM6IElSZXF1ZXN0LCByZXNwb25zZTogaHR0cC5JbmNvbWluZ01lc3NhZ2UgfCBudWxsLCBlcnI/OiB1bmtub3duKSB7XG4gICAgLy8gaWYgbm8gbG9nU3RyZWFtIGF2YWlsYWJsZSByZXR1cm4uXG4gICAgaWYgKCF0aGlzLmxvZ1N0cmVhbSkge1xuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QocmVxT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlcU9wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmIChyZXNwb25zZSAmJiAhaXNSZWFkYWJsZVN0cmVhbShyZXNwb25zZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3Jlc3BvbnNlIHNob3VsZCBiZSBvZiB0eXBlIFwiU3RyZWFtXCInKVxuICAgIH1cbiAgICBpZiAoZXJyICYmICEoZXJyIGluc3RhbmNlb2YgRXJyb3IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdlcnIgc2hvdWxkIGJlIG9mIHR5cGUgXCJFcnJvclwiJylcbiAgICB9XG4gICAgY29uc3QgbG9nU3RyZWFtID0gdGhpcy5sb2dTdHJlYW1cbiAgICBjb25zdCBsb2dIZWFkZXJzID0gKGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzKSA9PiB7XG4gICAgICBPYmplY3QuZW50cmllcyhoZWFkZXJzKS5mb3JFYWNoKChbaywgdl0pID0+IHtcbiAgICAgICAgaWYgKGsgPT0gJ2F1dGhvcml6YXRpb24nKSB7XG4gICAgICAgICAgaWYgKGlzU3RyaW5nKHYpKSB7XG4gICAgICAgICAgICBjb25zdCByZWRhY3RvciA9IG5ldyBSZWdFeHAoJ1NpZ25hdHVyZT0oWzAtOWEtZl0rKScpXG4gICAgICAgICAgICB2ID0gdi5yZXBsYWNlKHJlZGFjdG9yLCAnU2lnbmF0dXJlPSoqUkVEQUNURUQqKicpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGxvZ1N0cmVhbS53cml0ZShgJHtrfTogJHt2fVxcbmApXG4gICAgICB9KVxuICAgICAgbG9nU3RyZWFtLndyaXRlKCdcXG4nKVxuICAgIH1cbiAgICBsb2dTdHJlYW0ud3JpdGUoYFJFUVVFU1Q6ICR7cmVxT3B0aW9ucy5tZXRob2R9ICR7cmVxT3B0aW9ucy5wYXRofVxcbmApXG4gICAgbG9nSGVhZGVycyhyZXFPcHRpb25zLmhlYWRlcnMpXG4gICAgaWYgKHJlc3BvbnNlKSB7XG4gICAgICB0aGlzLmxvZ1N0cmVhbS53cml0ZShgUkVTUE9OU0U6ICR7cmVzcG9uc2Uuc3RhdHVzQ29kZX1cXG5gKVxuICAgICAgbG9nSGVhZGVycyhyZXNwb25zZS5oZWFkZXJzIGFzIFJlcXVlc3RIZWFkZXJzKVxuICAgIH1cbiAgICBpZiAoZXJyKSB7XG4gICAgICBsb2dTdHJlYW0ud3JpdGUoJ0VSUk9SIEJPRFk6XFxuJylcbiAgICAgIGNvbnN0IGVyckpTT04gPSBKU09OLnN0cmluZ2lmeShlcnIsIG51bGwsICdcXHQnKVxuICAgICAgbG9nU3RyZWFtLndyaXRlKGAke2VyckpTT059XFxuYClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5hYmxlIHRyYWNpbmdcbiAgICovXG4gIHB1YmxpYyB0cmFjZU9uKHN0cmVhbT86IHN0cmVhbS5Xcml0YWJsZSkge1xuICAgIGlmICghc3RyZWFtKSB7XG4gICAgICBzdHJlYW0gPSBwcm9jZXNzLnN0ZG91dFxuICAgIH1cbiAgICB0aGlzLmxvZ1N0cmVhbSA9IHN0cmVhbVxuICB9XG5cbiAgLyoqXG4gICAqIERpc2FibGUgdHJhY2luZ1xuICAgKi9cbiAgcHVibGljIHRyYWNlT2ZmKCkge1xuICAgIHRoaXMubG9nU3RyZWFtID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogbWFrZVJlcXVlc3QgaXMgdGhlIHByaW1pdGl2ZSB1c2VkIGJ5IHRoZSBhcGlzIGZvciBtYWtpbmcgUzMgcmVxdWVzdHMuXG4gICAqIHBheWxvYWQgY2FuIGJlIGVtcHR5IHN0cmluZyBpbiBjYXNlIG9mIG5vIHBheWxvYWQuXG4gICAqIHN0YXR1c0NvZGUgaXMgdGhlIGV4cGVjdGVkIHN0YXR1c0NvZGUuIElmIHJlc3BvbnNlLnN0YXR1c0NvZGUgZG9lcyBub3QgbWF0Y2hcbiAgICogd2UgcGFyc2UgdGhlIFhNTCBlcnJvciBhbmQgY2FsbCB0aGUgY2FsbGJhY2sgd2l0aCB0aGUgZXJyb3IgbWVzc2FnZS5cbiAgICpcbiAgICogQSB2YWxpZCByZWdpb24gaXMgcGFzc2VkIGJ5IHRoZSBjYWxscyAtIGxpc3RCdWNrZXRzLCBtYWtlQnVja2V0IGFuZCBnZXRCdWNrZXRSZWdpb24uXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgYXN5bmMgbWFrZVJlcXVlc3RBc3luYyhcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxuICAgIHBheWxvYWQ6IEJpbmFyeSA9ICcnLFxuICAgIGV4cGVjdGVkQ29kZXM6IG51bWJlcltdID0gWzIwMF0sXG4gICAgcmVnaW9uID0gJycsXG4gICk6IFByb21pc2U8aHR0cC5JbmNvbWluZ01lc3NhZ2U+IHtcbiAgICBpZiAoIWlzT2JqZWN0KG9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHBheWxvYWQpICYmICFpc09iamVjdChwYXlsb2FkKSkge1xuICAgICAgLy8gQnVmZmVyIGlzIG9mIHR5cGUgJ29iamVjdCdcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3BheWxvYWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIiBvciBcIkJ1ZmZlclwiJylcbiAgICB9XG4gICAgZXhwZWN0ZWRDb2Rlcy5mb3JFYWNoKChzdGF0dXNDb2RlKSA9PiB7XG4gICAgICBpZiAoIWlzTnVtYmVyKHN0YXR1c0NvZGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXR1c0NvZGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgICB9XG4gICAgfSlcbiAgICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlZ2lvbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFvcHRpb25zLmhlYWRlcnMpIHtcbiAgICAgIG9wdGlvbnMuaGVhZGVycyA9IHt9XG4gICAgfVxuICAgIGlmIChvcHRpb25zLm1ldGhvZCA9PT0gJ1BPU1QnIHx8IG9wdGlvbnMubWV0aG9kID09PSAnUFVUJyB8fCBvcHRpb25zLm1ldGhvZCA9PT0gJ0RFTEVURScpIHtcbiAgICAgIG9wdGlvbnMuaGVhZGVyc1snY29udGVudC1sZW5ndGgnXSA9IHBheWxvYWQubGVuZ3RoLnRvU3RyaW5nKClcbiAgICB9XG4gICAgY29uc3Qgc2hhMjU2c3VtID0gdGhpcy5lbmFibGVTSEEyNTYgPyB0b1NoYTI1NihwYXlsb2FkKSA6ICcnXG4gICAgcmV0dXJuIHRoaXMubWFrZVJlcXVlc3RTdHJlYW1Bc3luYyhvcHRpb25zLCBwYXlsb2FkLCBzaGEyNTZzdW0sIGV4cGVjdGVkQ29kZXMsIHJlZ2lvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBuZXcgcmVxdWVzdCB3aXRoIHByb21pc2VcbiAgICpcbiAgICogTm8gbmVlZCB0byBkcmFpbiByZXNwb25zZSwgcmVzcG9uc2UgYm9keSBpcyBub3QgdmFsaWRcbiAgICovXG4gIGFzeW5jIG1ha2VSZXF1ZXN0QXN5bmNPbWl0KFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgcGF5bG9hZDogQmluYXJ5ID0gJycsXG4gICAgc3RhdHVzQ29kZXM6IG51bWJlcltdID0gWzIwMF0sXG4gICAgcmVnaW9uID0gJycsXG4gICk6IFByb21pc2U8T21pdDxodHRwLkluY29taW5nTWVzc2FnZSwgJ29uJz4+IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMob3B0aW9ucywgcGF5bG9hZCwgc3RhdHVzQ29kZXMsIHJlZ2lvbilcbiAgICBhd2FpdCBkcmFpblJlc3BvbnNlKHJlcylcbiAgICByZXR1cm4gcmVzXG4gIH1cblxuICAvKipcbiAgICogbWFrZVJlcXVlc3RTdHJlYW0gd2lsbCBiZSB1c2VkIGRpcmVjdGx5IGluc3RlYWQgb2YgbWFrZVJlcXVlc3QgaW4gY2FzZSB0aGUgcGF5bG9hZFxuICAgKiBpcyBhdmFpbGFibGUgYXMgYSBzdHJlYW0uIGZvciBleC4gcHV0T2JqZWN0XG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgYXN5bmMgbWFrZVJlcXVlc3RTdHJlYW1Bc3luYyhcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxuICAgIGJvZHk6IHN0cmVhbS5SZWFkYWJsZSB8IEJpbmFyeSxcbiAgICBzaGEyNTZzdW06IHN0cmluZyxcbiAgICBzdGF0dXNDb2RlczogbnVtYmVyW10sXG4gICAgcmVnaW9uOiBzdHJpbmcsXG4gICk6IFByb21pc2U8aHR0cC5JbmNvbWluZ01lc3NhZ2U+IHtcbiAgICBpZiAoIWlzT2JqZWN0KG9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoIShCdWZmZXIuaXNCdWZmZXIoYm9keSkgfHwgdHlwZW9mIGJvZHkgPT09ICdzdHJpbmcnIHx8IGlzUmVhZGFibGVTdHJlYW0oYm9keSkpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICBgc3RyZWFtIHNob3VsZCBiZSBhIEJ1ZmZlciwgc3RyaW5nIG9yIHJlYWRhYmxlIFN0cmVhbSwgZ290ICR7dHlwZW9mIGJvZHl9IGluc3RlYWRgLFxuICAgICAgKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHNoYTI1NnN1bSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NoYTI1NnN1bSBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgc3RhdHVzQ29kZXMuZm9yRWFjaCgoc3RhdHVzQ29kZSkgPT4ge1xuICAgICAgaWYgKCFpc051bWJlcihzdGF0dXNDb2RlKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdGF0dXNDb2RlIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgICAgfVxuICAgIH0pXG4gICAgaWYgKCFpc1N0cmluZyhyZWdpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWdpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIC8vIHNoYTI1NnN1bSB3aWxsIGJlIGVtcHR5IGZvciBhbm9ueW1vdXMgb3IgaHR0cHMgcmVxdWVzdHNcbiAgICBpZiAoIXRoaXMuZW5hYmxlU0hBMjU2ICYmIHNoYTI1NnN1bS5sZW5ndGggIT09IDApIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYHNoYTI1NnN1bSBleHBlY3RlZCB0byBiZSBlbXB0eSBmb3IgYW5vbnltb3VzIG9yIGh0dHBzIHJlcXVlc3RzYClcbiAgICB9XG4gICAgLy8gc2hhMjU2c3VtIHNob3VsZCBiZSB2YWxpZCBmb3Igbm9uLWFub255bW91cyBodHRwIHJlcXVlc3RzLlxuICAgIGlmICh0aGlzLmVuYWJsZVNIQTI1NiAmJiBzaGEyNTZzdW0ubGVuZ3RoICE9PSA2NCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCBzaGEyNTZzdW0gOiAke3NoYTI1NnN1bX1gKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxuXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1ub24tbnVsbC1hc3NlcnRpb25cbiAgICByZWdpb24gPSByZWdpb24gfHwgKGF3YWl0IHRoaXMuZ2V0QnVja2V0UmVnaW9uQXN5bmMob3B0aW9ucy5idWNrZXROYW1lISkpXG5cbiAgICBjb25zdCByZXFPcHRpb25zID0gdGhpcy5nZXRSZXF1ZXN0T3B0aW9ucyh7IC4uLm9wdGlvbnMsIHJlZ2lvbiB9KVxuICAgIGlmICghdGhpcy5hbm9ueW1vdXMpIHtcbiAgICAgIC8vIEZvciBub24tYW5vbnltb3VzIGh0dHBzIHJlcXVlc3RzIHNoYTI1NnN1bSBpcyAnVU5TSUdORUQtUEFZTE9BRCcgZm9yIHNpZ25hdHVyZSBjYWxjdWxhdGlvbi5cbiAgICAgIGlmICghdGhpcy5lbmFibGVTSEEyNTYpIHtcbiAgICAgICAgc2hhMjU2c3VtID0gJ1VOU0lHTkVELVBBWUxPQUQnXG4gICAgICB9XG4gICAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoKVxuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzWyd4LWFtei1kYXRlJ10gPSBtYWtlRGF0ZUxvbmcoZGF0ZSlcbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVyc1sneC1hbXotY29udGVudC1zaGEyNTYnXSA9IHNoYTI1NnN1bVxuICAgICAgaWYgKHRoaXMuc2Vzc2lvblRva2VuKSB7XG4gICAgICAgIHJlcU9wdGlvbnMuaGVhZGVyc1sneC1hbXotc2VjdXJpdHktdG9rZW4nXSA9IHRoaXMuc2Vzc2lvblRva2VuXG4gICAgICB9XG4gICAgICByZXFPcHRpb25zLmhlYWRlcnMuYXV0aG9yaXphdGlvbiA9IHNpZ25WNChyZXFPcHRpb25zLCB0aGlzLmFjY2Vzc0tleSwgdGhpcy5zZWNyZXRLZXksIHJlZ2lvbiwgZGF0ZSwgc2hhMjU2c3VtKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcmVxdWVzdCh0aGlzLnRyYW5zcG9ydCwgcmVxT3B0aW9ucywgYm9keSlcbiAgICBpZiAoIXJlc3BvbnNlLnN0YXR1c0NvZGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJVRzogcmVzcG9uc2UgZG9lc24ndCBoYXZlIGEgc3RhdHVzQ29kZVwiKVxuICAgIH1cblxuICAgIGlmICghc3RhdHVzQ29kZXMuaW5jbHVkZXMocmVzcG9uc2Uuc3RhdHVzQ29kZSkpIHtcbiAgICAgIC8vIEZvciBhbiBpbmNvcnJlY3QgcmVnaW9uLCBTMyBzZXJ2ZXIgYWx3YXlzIHNlbmRzIGJhY2sgNDAwLlxuICAgICAgLy8gQnV0IHdlIHdpbGwgZG8gY2FjaGUgaW52YWxpZGF0aW9uIGZvciBhbGwgZXJyb3JzIHNvIHRoYXQsXG4gICAgICAvLyBpbiBmdXR1cmUsIGlmIEFXUyBTMyBkZWNpZGVzIHRvIHNlbmQgYSBkaWZmZXJlbnQgc3RhdHVzIGNvZGUgb3JcbiAgICAgIC8vIFhNTCBlcnJvciBjb2RlIHdlIHdpbGwgc3RpbGwgd29yayBmaW5lLlxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1ub24tbnVsbC1hc3NlcnRpb25cbiAgICAgIGRlbGV0ZSB0aGlzLnJlZ2lvbk1hcFtvcHRpb25zLmJ1Y2tldE5hbWUhXVxuXG4gICAgICBjb25zdCBlcnIgPSBhd2FpdCB4bWxQYXJzZXJzLnBhcnNlUmVzcG9uc2VFcnJvcihyZXNwb25zZSlcbiAgICAgIHRoaXMubG9nSFRUUChyZXFPcHRpb25zLCByZXNwb25zZSwgZXJyKVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuXG4gICAgdGhpcy5sb2dIVFRQKHJlcU9wdGlvbnMsIHJlc3BvbnNlKVxuXG4gICAgcmV0dXJuIHJlc3BvbnNlXG4gIH1cblxuICAvKipcbiAgICogZ2V0cyB0aGUgcmVnaW9uIG9mIHRoZSBidWNrZXRcbiAgICpcbiAgICogQHBhcmFtIGJ1Y2tldE5hbWVcbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgZ2V0QnVja2V0UmVnaW9uQXN5bmMoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWUgOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG5cbiAgICAvLyBSZWdpb24gaXMgc2V0IHdpdGggY29uc3RydWN0b3IsIHJldHVybiB0aGUgcmVnaW9uIHJpZ2h0IGhlcmUuXG4gICAgaWYgKHRoaXMucmVnaW9uKSB7XG4gICAgICByZXR1cm4gdGhpcy5yZWdpb25cbiAgICB9XG5cbiAgICBjb25zdCBjYWNoZWQgPSB0aGlzLnJlZ2lvbk1hcFtidWNrZXROYW1lXVxuICAgIGlmIChjYWNoZWQpIHtcbiAgICAgIHJldHVybiBjYWNoZWRcbiAgICB9XG5cbiAgICBjb25zdCBleHRyYWN0UmVnaW9uQXN5bmMgPSBhc3luYyAocmVzcG9uc2U6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB7XG4gICAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlc3BvbnNlKVxuICAgICAgY29uc3QgcmVnaW9uID0geG1sUGFyc2Vycy5wYXJzZUJ1Y2tldFJlZ2lvbihib2R5KSB8fCBERUZBVUxUX1JFR0lPTlxuICAgICAgdGhpcy5yZWdpb25NYXBbYnVja2V0TmFtZV0gPSByZWdpb25cbiAgICAgIHJldHVybiByZWdpb25cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xvY2F0aW9uJ1xuICAgIC8vIGBnZXRCdWNrZXRMb2NhdGlvbmAgYmVoYXZlcyBkaWZmZXJlbnRseSBpbiBmb2xsb3dpbmcgd2F5cyBmb3JcbiAgICAvLyBkaWZmZXJlbnQgZW52aXJvbm1lbnRzLlxuICAgIC8vXG4gICAgLy8gLSBGb3Igbm9kZWpzIGVudiB3ZSBkZWZhdWx0IHRvIHBhdGggc3R5bGUgcmVxdWVzdHMuXG4gICAgLy8gLSBGb3IgYnJvd3NlciBlbnYgcGF0aCBzdHlsZSByZXF1ZXN0cyBvbiBidWNrZXRzIHlpZWxkcyBDT1JTXG4gICAgLy8gICBlcnJvci4gVG8gY2lyY3VtdmVudCB0aGlzIHByb2JsZW0gd2UgbWFrZSBhIHZpcnR1YWwgaG9zdFxuICAgIC8vICAgc3R5bGUgcmVxdWVzdCBzaWduZWQgd2l0aCAndXMtZWFzdC0xJy4gVGhpcyByZXF1ZXN0IGZhaWxzXG4gICAgLy8gICB3aXRoIGFuIGVycm9yICdBdXRob3JpemF0aW9uSGVhZGVyTWFsZm9ybWVkJywgYWRkaXRpb25hbGx5XG4gICAgLy8gICB0aGUgZXJyb3IgWE1MIGFsc28gcHJvdmlkZXMgUmVnaW9uIG9mIHRoZSBidWNrZXQuIFRvIHZhbGlkYXRlXG4gICAgLy8gICB0aGlzIHJlZ2lvbiBpcyBwcm9wZXIgd2UgcmV0cnkgdGhlIHNhbWUgcmVxdWVzdCB3aXRoIHRoZSBuZXdseVxuICAgIC8vICAgb2J0YWluZWQgcmVnaW9uLlxuICAgIGNvbnN0IHBhdGhTdHlsZSA9IHRoaXMucGF0aFN0eWxlICYmICFpc0Jyb3dzZXJcbiAgICBsZXQgcmVnaW9uOiBzdHJpbmdcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgcGF0aFN0eWxlIH0sICcnLCBbMjAwXSwgREVGQVVMVF9SRUdJT04pXG4gICAgICByZXR1cm4gZXh0cmFjdFJlZ2lvbkFzeW5jKHJlcylcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICBpZiAoIShlLm5hbWUgPT09ICdBdXRob3JpemF0aW9uSGVhZGVyTWFsZm9ybWVkJykpIHtcbiAgICAgICAgdGhyb3cgZVxuICAgICAgfVxuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciB3ZSBzZXQgZXh0cmEgcHJvcGVydGllcyBvbiBlcnJvciBvYmplY3RcbiAgICAgIHJlZ2lvbiA9IGUuUmVnaW9uIGFzIHN0cmluZ1xuICAgICAgaWYgKCFyZWdpb24pIHtcbiAgICAgICAgdGhyb3cgZVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIHBhdGhTdHlsZSB9LCAnJywgWzIwMF0sIHJlZ2lvbilcbiAgICByZXR1cm4gYXdhaXQgZXh0cmFjdFJlZ2lvbkFzeW5jKHJlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBtYWtlUmVxdWVzdCBpcyB0aGUgcHJpbWl0aXZlIHVzZWQgYnkgdGhlIGFwaXMgZm9yIG1ha2luZyBTMyByZXF1ZXN0cy5cbiAgICogcGF5bG9hZCBjYW4gYmUgZW1wdHkgc3RyaW5nIGluIGNhc2Ugb2Ygbm8gcGF5bG9hZC5cbiAgICogc3RhdHVzQ29kZSBpcyB0aGUgZXhwZWN0ZWQgc3RhdHVzQ29kZS4gSWYgcmVzcG9uc2Uuc3RhdHVzQ29kZSBkb2VzIG5vdCBtYXRjaFxuICAgKiB3ZSBwYXJzZSB0aGUgWE1MIGVycm9yIGFuZCBjYWxsIHRoZSBjYWxsYmFjayB3aXRoIHRoZSBlcnJvciBtZXNzYWdlLlxuICAgKiBBIHZhbGlkIHJlZ2lvbiBpcyBwYXNzZWQgYnkgdGhlIGNhbGxzIC0gbGlzdEJ1Y2tldHMsIG1ha2VCdWNrZXQgYW5kXG4gICAqIGdldEJ1Y2tldFJlZ2lvbi5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGBtYWtlUmVxdWVzdEFzeW5jYCBpbnN0ZWFkXG4gICAqL1xuICBtYWtlUmVxdWVzdChcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxuICAgIHBheWxvYWQ6IEJpbmFyeSA9ICcnLFxuICAgIGV4cGVjdGVkQ29kZXM6IG51bWJlcltdID0gWzIwMF0sXG4gICAgcmVnaW9uID0gJycsXG4gICAgcmV0dXJuUmVzcG9uc2U6IGJvb2xlYW4sXG4gICAgY2I6IChjYjogdW5rbm93biwgcmVzdWx0OiBodHRwLkluY29taW5nTWVzc2FnZSkgPT4gdm9pZCxcbiAgKSB7XG4gICAgbGV0IHByb206IFByb21pc2U8aHR0cC5JbmNvbWluZ01lc3NhZ2U+XG4gICAgaWYgKHJldHVyblJlc3BvbnNlKSB7XG4gICAgICBwcm9tID0gdGhpcy5tYWtlUmVxdWVzdEFzeW5jKG9wdGlvbnMsIHBheWxvYWQsIGV4cGVjdGVkQ29kZXMsIHJlZ2lvbilcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBjb21wYXRpYmxlIGZvciBvbGQgYmVoYXZpb3VyXG4gICAgICBwcm9tID0gdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChvcHRpb25zLCBwYXlsb2FkLCBleHBlY3RlZENvZGVzLCByZWdpb24pXG4gICAgfVxuXG4gICAgcHJvbS50aGVuKFxuICAgICAgKHJlc3VsdCkgPT4gY2IobnVsbCwgcmVzdWx0KSxcbiAgICAgIChlcnIpID0+IHtcbiAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgIGNiKGVycilcbiAgICAgIH0sXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIG1ha2VSZXF1ZXN0U3RyZWFtIHdpbGwgYmUgdXNlZCBkaXJlY3RseSBpbnN0ZWFkIG9mIG1ha2VSZXF1ZXN0IGluIGNhc2UgdGhlIHBheWxvYWRcbiAgICogaXMgYXZhaWxhYmxlIGFzIGEgc3RyZWFtLiBmb3IgZXguIHB1dE9iamVjdFxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgYG1ha2VSZXF1ZXN0U3RyZWFtQXN5bmNgIGluc3RlYWRcbiAgICovXG4gIG1ha2VSZXF1ZXN0U3RyZWFtKFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgc3RyZWFtOiBzdHJlYW0uUmVhZGFibGUgfCBCdWZmZXIsXG4gICAgc2hhMjU2c3VtOiBzdHJpbmcsXG4gICAgc3RhdHVzQ29kZXM6IG51bWJlcltdLFxuICAgIHJlZ2lvbjogc3RyaW5nLFxuICAgIHJldHVyblJlc3BvbnNlOiBib29sZWFuLFxuICAgIGNiOiAoY2I6IHVua25vd24sIHJlc3VsdDogaHR0cC5JbmNvbWluZ01lc3NhZ2UpID0+IHZvaWQsXG4gICkge1xuICAgIGNvbnN0IGV4ZWN1dG9yID0gYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdFN0cmVhbUFzeW5jKG9wdGlvbnMsIHN0cmVhbSwgc2hhMjU2c3VtLCBzdGF0dXNDb2RlcywgcmVnaW9uKVxuICAgICAgaWYgKCFyZXR1cm5SZXNwb25zZSkge1xuICAgICAgICBhd2FpdCBkcmFpblJlc3BvbnNlKHJlcylcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc1xuICAgIH1cblxuICAgIGV4ZWN1dG9yKCkudGhlbihcbiAgICAgIChyZXN1bHQpID0+IGNiKG51bGwsIHJlc3VsdCksXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAoZXJyKSA9PiBjYihlcnIpLFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgYGdldEJ1Y2tldFJlZ2lvbkFzeW5jYCBpbnN0ZWFkXG4gICAqL1xuICBnZXRCdWNrZXRSZWdpb24oYnVja2V0TmFtZTogc3RyaW5nLCBjYjogKGVycjogdW5rbm93biwgcmVnaW9uOiBzdHJpbmcpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRCdWNrZXRSZWdpb25Bc3luYyhidWNrZXROYW1lKS50aGVuKFxuICAgICAgKHJlc3VsdCkgPT4gY2IobnVsbCwgcmVzdWx0KSxcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIChlcnIpID0+IGNiKGVyciksXG4gICAgKVxuICB9XG5cbiAgLy8gQnVja2V0IG9wZXJhdGlvbnNcblxuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgYnVja2V0IGBidWNrZXROYW1lYC5cbiAgICpcbiAgICovXG4gIGFzeW5jIG1ha2VCdWNrZXQoYnVja2V0TmFtZTogc3RyaW5nLCByZWdpb246IFJlZ2lvbiA9ICcnLCBtYWtlT3B0czogTWFrZUJ1Y2tldE9wdCA9IHt9KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgLy8gQmFja3dhcmQgQ29tcGF0aWJpbGl0eVxuICAgIGlmIChpc09iamVjdChyZWdpb24pKSB7XG4gICAgICBtYWtlT3B0cyA9IHJlZ2lvblxuICAgICAgcmVnaW9uID0gJydcbiAgICB9XG5cbiAgICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlZ2lvbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChtYWtlT3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21ha2VPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGxldCBwYXlsb2FkID0gJydcblxuICAgIC8vIFJlZ2lvbiBhbHJlYWR5IHNldCBpbiBjb25zdHJ1Y3RvciwgdmFsaWRhdGUgaWZcbiAgICAvLyBjYWxsZXIgcmVxdWVzdGVkIGJ1Y2tldCBsb2NhdGlvbiBpcyBzYW1lLlxuICAgIGlmIChyZWdpb24gJiYgdGhpcy5yZWdpb24pIHtcbiAgICAgIGlmIChyZWdpb24gIT09IHRoaXMucmVnaW9uKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYENvbmZpZ3VyZWQgcmVnaW9uICR7dGhpcy5yZWdpb259LCByZXF1ZXN0ZWQgJHtyZWdpb259YClcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gc2VuZGluZyBtYWtlQnVja2V0IHJlcXVlc3Qgd2l0aCBYTUwgY29udGFpbmluZyAndXMtZWFzdC0xJyBmYWlscy4gRm9yXG4gICAgLy8gZGVmYXVsdCByZWdpb24gc2VydmVyIGV4cGVjdHMgdGhlIHJlcXVlc3Qgd2l0aG91dCBib2R5XG4gICAgaWYgKHJlZ2lvbiAmJiByZWdpb24gIT09IERFRkFVTFRfUkVHSU9OKSB7XG4gICAgICBwYXlsb2FkID0geG1sLmJ1aWxkT2JqZWN0KHtcbiAgICAgICAgQ3JlYXRlQnVja2V0Q29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICQ6IHsgeG1sbnM6ICdodHRwOi8vczMuYW1hem9uYXdzLmNvbS9kb2MvMjAwNi0wMy0wMS8nIH0sXG4gICAgICAgICAgTG9jYXRpb25Db25zdHJhaW50OiByZWdpb24sXG4gICAgICAgIH0sXG4gICAgICB9KVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cblxuICAgIGlmIChtYWtlT3B0cy5PYmplY3RMb2NraW5nKSB7XG4gICAgICBoZWFkZXJzWyd4LWFtei1idWNrZXQtb2JqZWN0LWxvY2stZW5hYmxlZCddID0gdHJ1ZVxuICAgIH1cblxuICAgIC8vIEZvciBjdXN0b20gcmVnaW9uIGNsaWVudHMgIGRlZmF1bHQgdG8gY3VzdG9tIHJlZ2lvbiBzcGVjaWZpZWQgaW4gY2xpZW50IGNvbnN0cnVjdG9yXG4gICAgY29uc3QgZmluYWxSZWdpb24gPSB0aGlzLnJlZ2lvbiB8fCByZWdpb24gfHwgREVGQVVMVF9SRUdJT05cblxuICAgIGNvbnN0IHJlcXVlc3RPcHQ6IFJlcXVlc3RPcHRpb24gPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgaGVhZGVycyB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChyZXF1ZXN0T3B0LCBwYXlsb2FkLCBbMjAwXSwgZmluYWxSZWdpb24pXG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICBpZiAocmVnaW9uID09PSAnJyB8fCByZWdpb24gPT09IERFRkFVTFRfUkVHSU9OKSB7XG4gICAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBlcnJvcnMuUzNFcnJvcikge1xuICAgICAgICAgIGNvbnN0IGVyckNvZGUgPSBlcnIuY29kZVxuICAgICAgICAgIGNvbnN0IGVyclJlZ2lvbiA9IGVyci5yZWdpb25cbiAgICAgICAgICBpZiAoZXJyQ29kZSA9PT0gJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnICYmIGVyclJlZ2lvbiAhPT0gJycpIHtcbiAgICAgICAgICAgIC8vIFJldHJ5IHdpdGggcmVnaW9uIHJldHVybmVkIGFzIHBhcnQgb2YgZXJyb3JcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQocmVxdWVzdE9wdCwgcGF5bG9hZCwgWzIwMF0sIGVyckNvZGUpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVG8gY2hlY2sgaWYgYSBidWNrZXQgYWxyZWFkeSBleGlzdHMuXG4gICAqL1xuICBhc3luYyBidWNrZXRFeGlzdHMoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0hFQUQnXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUgfSlcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIGlmIChlcnIuY29kZSA9PT0gJ05vU3VjaEJ1Y2tldCcgfHwgZXJyLmNvZGUgPT09ICdOb3RGb3VuZCcpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD5cblxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHByb21pc2Ugc3R5bGUgQVBJXG4gICAqL1xuICByZW1vdmVCdWNrZXQoYnVja2V0TmFtZTogc3RyaW5nLCBjYWxsYmFjazogTm9SZXN1bHRDYWxsYmFjayk6IHZvaWRcblxuICBhc3luYyByZW1vdmVCdWNrZXQoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lIH0sICcnLCBbMjA0XSlcbiAgICBkZWxldGUgdGhpcy5yZWdpb25NYXBbYnVja2V0TmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsYmFjayBpcyBjYWxsZWQgd2l0aCByZWFkYWJsZSBzdHJlYW0gb2YgdGhlIG9iamVjdCBjb250ZW50LlxuICAgKi9cbiAgYXN5bmMgZ2V0T2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBnZXRPcHRzOiBHZXRPYmplY3RPcHRzID0ge30pOiBQcm9taXNlPHN0cmVhbS5SZWFkYWJsZT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIHJldHVybiB0aGlzLmdldFBhcnRpYWxPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgMCwgMCwgZ2V0T3B0cylcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsYmFjayBpcyBjYWxsZWQgd2l0aCByZWFkYWJsZSBzdHJlYW0gb2YgdGhlIHBhcnRpYWwgb2JqZWN0IGNvbnRlbnQuXG4gICAqIEBwYXJhbSBidWNrZXROYW1lXG4gICAqIEBwYXJhbSBvYmplY3ROYW1lXG4gICAqIEBwYXJhbSBvZmZzZXRcbiAgICogQHBhcmFtIGxlbmd0aCAtIGxlbmd0aCBvZiB0aGUgb2JqZWN0IHRoYXQgd2lsbCBiZSByZWFkIGluIHRoZSBzdHJlYW0gKG9wdGlvbmFsLCBpZiBub3Qgc3BlY2lmaWVkIHdlIHJlYWQgdGhlIHJlc3Qgb2YgdGhlIGZpbGUgZnJvbSB0aGUgb2Zmc2V0KVxuICAgKiBAcGFyYW0gZ2V0T3B0c1xuICAgKi9cbiAgYXN5bmMgZ2V0UGFydGlhbE9iamVjdChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIG9mZnNldDogbnVtYmVyLFxuICAgIGxlbmd0aCA9IDAsXG4gICAgZ2V0T3B0czogR2V0T2JqZWN0T3B0cyA9IHt9LFxuICApOiBQcm9taXNlPHN0cmVhbS5SZWFkYWJsZT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIob2Zmc2V0KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb2Zmc2V0IHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKGxlbmd0aCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xlbmd0aCBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG5cbiAgICBsZXQgcmFuZ2UgPSAnJ1xuICAgIGlmIChvZmZzZXQgfHwgbGVuZ3RoKSB7XG4gICAgICBpZiAob2Zmc2V0KSB7XG4gICAgICAgIHJhbmdlID0gYGJ5dGVzPSR7K29mZnNldH0tYFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmFuZ2UgPSAnYnl0ZXM9MC0nXG4gICAgICAgIG9mZnNldCA9IDBcbiAgICAgIH1cbiAgICAgIGlmIChsZW5ndGgpIHtcbiAgICAgICAgcmFuZ2UgKz0gYCR7K2xlbmd0aCArIG9mZnNldCAtIDF9YFxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHNzZUhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICAuLi4oZ2V0T3B0cy5TU0VDdXN0b21lckFsZ29yaXRobSAmJiB7XG4gICAgICAgICdYLUFtei1TZXJ2ZXItU2lkZS1FbmNyeXB0aW9uLUN1c3RvbWVyLUFsZ29yaXRobSc6IGdldE9wdHMuU1NFQ3VzdG9tZXJBbGdvcml0aG0sXG4gICAgICB9KSxcbiAgICAgIC4uLihnZXRPcHRzLlNTRUN1c3RvbWVyS2V5ICYmIHsgJ1gtQW16LVNlcnZlci1TaWRlLUVuY3J5cHRpb24tQ3VzdG9tZXItS2V5JzogZ2V0T3B0cy5TU0VDdXN0b21lcktleSB9KSxcbiAgICAgIC4uLihnZXRPcHRzLlNTRUN1c3RvbWVyS2V5TUQ1ICYmIHsgJ1gtQW16LVNlcnZlci1TaWRlLUVuY3J5cHRpb24tQ3VzdG9tZXItS2V5LU1ENSc6IGdldE9wdHMuU1NFQ3VzdG9tZXJLZXlNRDUgfSksXG4gICAgfVxuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7XG4gICAgICAuLi5wcmVwZW5kWEFNWk1ldGEoc3NlSGVhZGVycyksXG4gICAgICAuLi4ocmFuZ2UgIT09ICcnICYmIHsgcmFuZ2UgfSksXG4gICAgfVxuXG4gICAgY29uc3QgZXhwZWN0ZWRTdGF0dXNDb2RlcyA9IFsyMDBdXG4gICAgaWYgKHJhbmdlKSB7XG4gICAgICBleHBlY3RlZFN0YXR1c0NvZGVzLnB1c2goMjA2KVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuXG4gICAgY29uc3QgcXVlcnkgPSBxcy5zdHJpbmdpZnkoZ2V0T3B0cylcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBxdWVyeSB9LCAnJywgZXhwZWN0ZWRTdGF0dXNDb2RlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBkb3dubG9hZCBvYmplY3QgY29udGVudCB0byBhIGZpbGUuXG4gICAqIFRoaXMgbWV0aG9kIHdpbGwgY3JlYXRlIGEgdGVtcCBmaWxlIG5hbWVkIGAke2ZpbGVuYW1lfS4ke2V0YWd9LnBhcnQubWluaW9gIHdoZW4gZG93bmxvYWRpbmcuXG4gICAqXG4gICAqIEBwYXJhbSBidWNrZXROYW1lIC0gbmFtZSBvZiB0aGUgYnVja2V0XG4gICAqIEBwYXJhbSBvYmplY3ROYW1lIC0gbmFtZSBvZiB0aGUgb2JqZWN0XG4gICAqIEBwYXJhbSBmaWxlUGF0aCAtIHBhdGggdG8gd2hpY2ggdGhlIG9iamVjdCBkYXRhIHdpbGwgYmUgd3JpdHRlbiB0b1xuICAgKiBAcGFyYW0gZ2V0T3B0cyAtIE9wdGlvbmFsIG9iamVjdCBnZXQgb3B0aW9uXG4gICAqL1xuICBhc3luYyBmR2V0T2JqZWN0KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZmlsZVBhdGg6IHN0cmluZyxcbiAgICBnZXRPcHRzOiBHZXRPYmplY3RPcHRzID0ge30sXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIElucHV0IHZhbGlkYXRpb24uXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhmaWxlUGF0aCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2ZpbGVQYXRoIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cblxuICAgIGNvbnN0IGRvd25sb2FkVG9UbXBGaWxlID0gYXN5bmMgKCk6IFByb21pc2U8c3RyaW5nPiA9PiB7XG4gICAgICBsZXQgcGFydEZpbGVTdHJlYW06IHN0cmVhbS5Xcml0YWJsZVxuICAgICAgY29uc3Qgb2JqU3RhdCA9IGF3YWl0IHRoaXMuc3RhdE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBnZXRPcHRzKVxuICAgICAgY29uc3QgcGFydEZpbGUgPSBgJHtmaWxlUGF0aH0uJHtvYmpTdGF0LmV0YWd9LnBhcnQubWluaW9gXG5cbiAgICAgIGF3YWl0IGZzcC5ta2RpcihwYXRoLmRpcm5hbWUoZmlsZVBhdGgpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KVxuXG4gICAgICBsZXQgb2Zmc2V0ID0gMFxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmc3Auc3RhdChwYXJ0RmlsZSlcbiAgICAgICAgaWYgKG9ialN0YXQuc2l6ZSA9PT0gc3RhdHMuc2l6ZSkge1xuICAgICAgICAgIHJldHVybiBwYXJ0RmlsZVxuICAgICAgICB9XG4gICAgICAgIG9mZnNldCA9IHN0YXRzLnNpemVcbiAgICAgICAgcGFydEZpbGVTdHJlYW0gPSBmcy5jcmVhdGVXcml0ZVN0cmVhbShwYXJ0RmlsZSwgeyBmbGFnczogJ2EnIH0pXG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGlmIChlIGluc3RhbmNlb2YgRXJyb3IgJiYgKGUgYXMgdW5rbm93biBhcyB7IGNvZGU6IHN0cmluZyB9KS5jb2RlID09PSAnRU5PRU5UJykge1xuICAgICAgICAgIC8vIGZpbGUgbm90IGV4aXN0XG4gICAgICAgICAgcGFydEZpbGVTdHJlYW0gPSBmcy5jcmVhdGVXcml0ZVN0cmVhbShwYXJ0RmlsZSwgeyBmbGFnczogJ3cnIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gb3RoZXIgZXJyb3IsIG1heWJlIGFjY2VzcyBkZW55XG4gICAgICAgICAgdGhyb3cgZVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGRvd25sb2FkU3RyZWFtID0gYXdhaXQgdGhpcy5nZXRQYXJ0aWFsT2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIG9mZnNldCwgMCwgZ2V0T3B0cylcblxuICAgICAgYXdhaXQgc3RyZWFtUHJvbWlzZS5waXBlbGluZShkb3dubG9hZFN0cmVhbSwgcGFydEZpbGVTdHJlYW0pXG4gICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzcC5zdGF0KHBhcnRGaWxlKVxuICAgICAgaWYgKHN0YXRzLnNpemUgPT09IG9ialN0YXQuc2l6ZSkge1xuICAgICAgICByZXR1cm4gcGFydEZpbGVcbiAgICAgIH1cblxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdTaXplIG1pc21hdGNoIGJldHdlZW4gZG93bmxvYWRlZCBmaWxlIGFuZCB0aGUgb2JqZWN0JylcbiAgICB9XG5cbiAgICBjb25zdCBwYXJ0RmlsZSA9IGF3YWl0IGRvd25sb2FkVG9UbXBGaWxlKClcbiAgICBhd2FpdCBmc3AucmVuYW1lKHBhcnRGaWxlLCBmaWxlUGF0aClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGF0IGluZm9ybWF0aW9uIG9mIHRoZSBvYmplY3QuXG4gICAqL1xuICBhc3luYyBzdGF0T2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBzdGF0T3B0czogU3RhdE9iamVjdE9wdHMgPSB7fSk6IFByb21pc2U8QnVja2V0SXRlbVN0YXQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghaXNPYmplY3Qoc3RhdE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdzdGF0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyeSA9IHFzLnN0cmluZ2lmeShzdGF0T3B0cylcbiAgICBjb25zdCBtZXRob2QgPSAnSEVBRCdcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNpemU6IHBhcnNlSW50KHJlcy5oZWFkZXJzWydjb250ZW50LWxlbmd0aCddIGFzIHN0cmluZyksXG4gICAgICBtZXRhRGF0YTogZXh0cmFjdE1ldGFkYXRhKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICAgIGxhc3RNb2RpZmllZDogbmV3IERhdGUocmVzLmhlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXSBhcyBzdHJpbmcpLFxuICAgICAgdmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzLmhlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgICAgZXRhZzogc2FuaXRpemVFVGFnKHJlcy5oZWFkZXJzLmV0YWcpLFxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHJlbW92ZU9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgcmVtb3ZlT3B0cz86IFJlbW92ZU9wdGlvbnMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChyZW1vdmVPcHRzICYmICFpc09iamVjdChyZW1vdmVPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVtb3ZlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGlmIChyZW1vdmVPcHRzPy5nb3Zlcm5hbmNlQnlwYXNzKSB7XG4gICAgICBoZWFkZXJzWydYLUFtei1CeXBhc3MtR292ZXJuYW5jZS1SZXRlbnRpb24nXSA9IHRydWVcbiAgICB9XG4gICAgaWYgKHJlbW92ZU9wdHM/LmZvcmNlRGVsZXRlKSB7XG4gICAgICBoZWFkZXJzWyd4LW1pbmlvLWZvcmNlLWRlbGV0ZSddID0gdHJ1ZVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5UGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cbiAgICBpZiAocmVtb3ZlT3B0cz8udmVyc2lvbklkKSB7XG4gICAgICBxdWVyeVBhcmFtcy52ZXJzaW9uSWQgPSBgJHtyZW1vdmVPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHF1ZXJ5ID0gcXMuc3RyaW5naWZ5KHF1ZXJ5UGFyYW1zKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycywgcXVlcnkgfSwgJycsIFsyMDAsIDIwNF0pXG4gIH1cblxuICAvLyBDYWxscyBpbXBsZW1lbnRlZCBiZWxvdyBhcmUgcmVsYXRlZCB0byBtdWx0aXBhcnQuXG5cbiAgbGlzdEluY29tcGxldGVVcGxvYWRzKFxuICAgIGJ1Y2tldDogc3RyaW5nLFxuICAgIHByZWZpeDogc3RyaW5nLFxuICAgIHJlY3Vyc2l2ZTogYm9vbGVhbixcbiAgKTogQnVja2V0U3RyZWFtPEluY29tcGxldGVVcGxvYWRlZEJ1Y2tldEl0ZW0+IHtcbiAgICBpZiAocHJlZml4ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHByZWZpeCA9ICcnXG4gICAgfVxuICAgIGlmIChyZWN1cnNpdmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVjdXJzaXZlID0gZmFsc2VcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXQpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXQpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZFByZWZpeChwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRQcmVmaXhFcnJvcihgSW52YWxpZCBwcmVmaXggOiAke3ByZWZpeH1gKVxuICAgIH1cbiAgICBpZiAoIWlzQm9vbGVhbihyZWN1cnNpdmUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWN1cnNpdmUgc2hvdWxkIGJlIG9mIHR5cGUgXCJib29sZWFuXCInKVxuICAgIH1cbiAgICBjb25zdCBkZWxpbWl0ZXIgPSByZWN1cnNpdmUgPyAnJyA6ICcvJ1xuICAgIGxldCBrZXlNYXJrZXIgPSAnJ1xuICAgIGxldCB1cGxvYWRJZE1hcmtlciA9ICcnXG4gICAgY29uc3QgdXBsb2FkczogdW5rbm93bltdID0gW11cbiAgICBsZXQgZW5kZWQgPSBmYWxzZVxuXG4gICAgLy8gVE9ETzogcmVmYWN0b3IgdGhpcyB3aXRoIGFzeW5jL2F3YWl0IGFuZCBgc3RyZWFtLlJlYWRhYmxlLmZyb21gXG4gICAgY29uc3QgcmVhZFN0cmVhbSA9IG5ldyBzdHJlYW0uUmVhZGFibGUoeyBvYmplY3RNb2RlOiB0cnVlIH0pXG4gICAgcmVhZFN0cmVhbS5fcmVhZCA9ICgpID0+IHtcbiAgICAgIC8vIHB1c2ggb25lIHVwbG9hZCBpbmZvIHBlciBfcmVhZCgpXG4gICAgICBpZiAodXBsb2Fkcy5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIHJlYWRTdHJlYW0ucHVzaCh1cGxvYWRzLnNoaWZ0KCkpXG4gICAgICB9XG4gICAgICBpZiAoZW5kZWQpIHtcbiAgICAgICAgcmV0dXJuIHJlYWRTdHJlYW0ucHVzaChudWxsKVxuICAgICAgfVxuICAgICAgdGhpcy5saXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShidWNrZXQsIHByZWZpeCwga2V5TWFya2VyLCB1cGxvYWRJZE1hcmtlciwgZGVsaW1pdGVyKS50aGVuKFxuICAgICAgICAocmVzdWx0KSA9PiB7XG4gICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICByZXN1bHQucHJlZml4ZXMuZm9yRWFjaCgocHJlZml4KSA9PiB1cGxvYWRzLnB1c2gocHJlZml4KSlcbiAgICAgICAgICBhc3luYy5lYWNoU2VyaWVzKFxuICAgICAgICAgICAgcmVzdWx0LnVwbG9hZHMsXG4gICAgICAgICAgICAodXBsb2FkLCBjYikgPT4ge1xuICAgICAgICAgICAgICAvLyBmb3IgZWFjaCBpbmNvbXBsZXRlIHVwbG9hZCBhZGQgdGhlIHNpemVzIG9mIGl0cyB1cGxvYWRlZCBwYXJ0c1xuICAgICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgdGhpcy5saXN0UGFydHMoYnVja2V0LCB1cGxvYWQua2V5LCB1cGxvYWQudXBsb2FkSWQpLnRoZW4oXG4gICAgICAgICAgICAgICAgKHBhcnRzOiBQYXJ0W10pID0+IHtcbiAgICAgICAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgICAgIHVwbG9hZC5zaXplID0gcGFydHMucmVkdWNlKChhY2MsIGl0ZW0pID0+IGFjYyArIGl0ZW0uc2l6ZSwgMClcbiAgICAgICAgICAgICAgICAgIHVwbG9hZHMucHVzaCh1cGxvYWQpXG4gICAgICAgICAgICAgICAgICBjYigpXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAoZXJyOiBFcnJvcikgPT4gY2IoZXJyKSxcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIChlcnIpID0+IHtcbiAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgIHJlYWRTdHJlYW0uZW1pdCgnZXJyb3InLCBlcnIpXG4gICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xuICAgICAgICAgICAgICAgIGtleU1hcmtlciA9IHJlc3VsdC5uZXh0S2V5TWFya2VyXG4gICAgICAgICAgICAgICAgdXBsb2FkSWRNYXJrZXIgPSByZXN1bHQubmV4dFVwbG9hZElkTWFya2VyXG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZW5kZWQgPSB0cnVlXG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgcmVhZFN0cmVhbS5fcmVhZCgpXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIClcbiAgICAgICAgfSxcbiAgICAgICAgKGUpID0+IHtcbiAgICAgICAgICByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZSlcbiAgICAgICAgfSxcbiAgICAgIClcbiAgICB9XG4gICAgcmV0dXJuIHJlYWRTdHJlYW1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgYnkgbGlzdEluY29tcGxldGVVcGxvYWRzIHRvIGZldGNoIGEgYmF0Y2ggb2YgaW5jb21wbGV0ZSB1cGxvYWRzLlxuICAgKi9cbiAgYXN5bmMgbGlzdEluY29tcGxldGVVcGxvYWRzUXVlcnkoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIHByZWZpeDogc3RyaW5nLFxuICAgIGtleU1hcmtlcjogc3RyaW5nLFxuICAgIHVwbG9hZElkTWFya2VyOiBzdHJpbmcsXG4gICAgZGVsaW1pdGVyOiBzdHJpbmcsXG4gICk6IFByb21pc2U8TGlzdE11bHRpcGFydFJlc3VsdD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGtleU1hcmtlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2tleU1hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZE1hcmtlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkTWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGRlbGltaXRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2RlbGltaXRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgY29uc3QgcXVlcmllcyA9IFtdXG4gICAgcXVlcmllcy5wdXNoKGBwcmVmaXg9JHt1cmlFc2NhcGUocHJlZml4KX1gKVxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKGRlbGltaXRlcil9YClcblxuICAgIGlmIChrZXlNYXJrZXIpIHtcbiAgICAgIHF1ZXJpZXMucHVzaChga2V5LW1hcmtlcj0ke3VyaUVzY2FwZShrZXlNYXJrZXIpfWApXG4gICAgfVxuICAgIGlmICh1cGxvYWRJZE1hcmtlcikge1xuICAgICAgcXVlcmllcy5wdXNoKGB1cGxvYWQtaWQtbWFya2VyPSR7dXBsb2FkSWRNYXJrZXJ9YClcbiAgICB9XG5cbiAgICBjb25zdCBtYXhVcGxvYWRzID0gMTAwMFxuICAgIHF1ZXJpZXMucHVzaChgbWF4LXVwbG9hZHM9JHttYXhVcGxvYWRzfWApXG4gICAgcXVlcmllcy5zb3J0KClcbiAgICBxdWVyaWVzLnVuc2hpZnQoJ3VwbG9hZHMnKVxuICAgIGxldCBxdWVyeSA9ICcnXG4gICAgaWYgKHF1ZXJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyaWVzLmpvaW4oJyYnKX1gXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlTGlzdE11bHRpcGFydChib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYXRlIGEgbmV3IG11bHRpcGFydCB1cGxvYWQuXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgYXN5bmMgaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGhlYWRlcnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoJ2NvbnRlbnRUeXBlIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnUE9TVCdcbiAgICBjb25zdCBxdWVyeSA9ICd1cGxvYWRzJ1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzQnVmZmVyKHJlcylcbiAgICByZXR1cm4gcGFyc2VJbml0aWF0ZU11bHRpcGFydChib2R5LnRvU3RyaW5nKCkpXG4gIH1cblxuICAvKipcbiAgICogSW50ZXJuYWwgTWV0aG9kIHRvIGFib3J0IGEgbXVsdGlwYXJ0IHVwbG9hZCByZXF1ZXN0IGluIGNhc2Ugb2YgYW55IGVycm9ycy5cbiAgICpcbiAgICogQHBhcmFtIGJ1Y2tldE5hbWUgLSBCdWNrZXQgTmFtZVxuICAgKiBAcGFyYW0gb2JqZWN0TmFtZSAtIE9iamVjdCBOYW1lXG4gICAqIEBwYXJhbSB1cGxvYWRJZCAtIGlkIG9mIGEgbXVsdGlwYXJ0IHVwbG9hZCB0byBjYW5jZWwgZHVyaW5nIGNvbXBvc2Ugb2JqZWN0IHNlcXVlbmNlLlxuICAgKi9cbiAgYXN5bmMgYWJvcnRNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHVwbG9hZElkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXBsb2FkSWR9YFxuXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZTogb2JqZWN0TmFtZSwgcXVlcnkgfVxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQocmVxdWVzdE9wdGlvbnMsICcnLCBbMjA0XSlcbiAgfVxuXG4gIGFzeW5jIGZpbmRVcGxvYWRJZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBsZXQgbGF0ZXN0VXBsb2FkOiBMaXN0TXVsdGlwYXJ0UmVzdWx0Wyd1cGxvYWRzJ11bbnVtYmVyXSB8IHVuZGVmaW5lZFxuICAgIGxldCBrZXlNYXJrZXIgPSAnJ1xuICAgIGxldCB1cGxvYWRJZE1hcmtlciA9ICcnXG4gICAgZm9yICg7Oykge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5saXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShidWNrZXROYW1lLCBvYmplY3ROYW1lLCBrZXlNYXJrZXIsIHVwbG9hZElkTWFya2VyLCAnJylcbiAgICAgIGZvciAoY29uc3QgdXBsb2FkIG9mIHJlc3VsdC51cGxvYWRzKSB7XG4gICAgICAgIGlmICh1cGxvYWQua2V5ID09PSBvYmplY3ROYW1lKSB7XG4gICAgICAgICAgaWYgKCFsYXRlc3RVcGxvYWQgfHwgdXBsb2FkLmluaXRpYXRlZC5nZXRUaW1lKCkgPiBsYXRlc3RVcGxvYWQuaW5pdGlhdGVkLmdldFRpbWUoKSkge1xuICAgICAgICAgICAgbGF0ZXN0VXBsb2FkID0gdXBsb2FkXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAocmVzdWx0LmlzVHJ1bmNhdGVkKSB7XG4gICAgICAgIGtleU1hcmtlciA9IHJlc3VsdC5uZXh0S2V5TWFya2VyXG4gICAgICAgIHVwbG9hZElkTWFya2VyID0gcmVzdWx0Lm5leHRVcGxvYWRJZE1hcmtlclxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBicmVha1xuICAgIH1cbiAgICByZXR1cm4gbGF0ZXN0VXBsb2FkPy51cGxvYWRJZFxuICB9XG5cbiAgLyoqXG4gICAqIHRoaXMgY2FsbCB3aWxsIGFnZ3JlZ2F0ZSB0aGUgcGFydHMgb24gdGhlIHNlcnZlciBpbnRvIGEgc2luZ2xlIG9iamVjdC5cbiAgICovXG4gIGFzeW5jIGNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgdXBsb2FkSWQ6IHN0cmluZyxcbiAgICBldGFnczoge1xuICAgICAgcGFydDogbnVtYmVyXG4gICAgICBldGFnPzogc3RyaW5nXG4gICAgfVtdLFxuICApOiBQcm9taXNlPHsgZXRhZzogc3RyaW5nOyB2ZXJzaW9uSWQ6IHN0cmluZyB8IG51bGwgfT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChldGFncykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2V0YWdzIHNob3VsZCBiZSBvZiB0eXBlIFwiQXJyYXlcIicpXG4gICAgfVxuXG4gICAgaWYgKCF1cGxvYWRJZCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndXBsb2FkSWQgY2Fubm90IGJlIGVtcHR5JylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUE9TVCdcbiAgICBjb25zdCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VyaUVzY2FwZSh1cGxvYWRJZCl9YFxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcigpXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3Qoe1xuICAgICAgQ29tcGxldGVNdWx0aXBhcnRVcGxvYWQ6IHtcbiAgICAgICAgJDoge1xuICAgICAgICAgIHhtbG5zOiAnaHR0cDovL3MzLmFtYXpvbmF3cy5jb20vZG9jLzIwMDYtMDMtMDEvJyxcbiAgICAgICAgfSxcbiAgICAgICAgUGFydDogZXRhZ3MubWFwKChldGFnKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIFBhcnROdW1iZXI6IGV0YWcucGFydCxcbiAgICAgICAgICAgIEVUYWc6IGV0YWcuZXRhZyxcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCBwYXlsb2FkKVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNCdWZmZXIocmVzKVxuICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlQ29tcGxldGVNdWx0aXBhcnQoYm9keS50b1N0cmluZygpKVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JVRzogZmFpbGVkIHRvIHBhcnNlIHNlcnZlciByZXNwb25zZScpXG4gICAgfVxuXG4gICAgaWYgKHJlc3VsdC5lcnJDb2RlKSB7XG4gICAgICAvLyBNdWx0aXBhcnQgQ29tcGxldGUgQVBJIHJldHVybnMgYW4gZXJyb3IgWE1MIGFmdGVyIGEgMjAwIGh0dHAgc3RhdHVzXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLlMzRXJyb3IocmVzdWx0LmVyck1lc3NhZ2UpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIGV0YWc6IHJlc3VsdC5ldGFnIGFzIHN0cmluZyxcbiAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0IHBhcnQtaW5mbyBvZiBhbGwgcGFydHMgb2YgYW4gaW5jb21wbGV0ZSB1cGxvYWQgc3BlY2lmaWVkIGJ5IHVwbG9hZElkLlxuICAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGxpc3RQYXJ0cyhidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgdXBsb2FkSWQ6IHN0cmluZyk6IFByb21pc2U8VXBsb2FkZWRQYXJ0W10+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghdXBsb2FkSWQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3VwbG9hZElkIGNhbm5vdCBiZSBlbXB0eScpXG4gICAgfVxuXG4gICAgY29uc3QgcGFydHM6IFVwbG9hZGVkUGFydFtdID0gW11cbiAgICBsZXQgbWFya2VyID0gMFxuICAgIGxldCByZXN1bHRcbiAgICBkbyB7XG4gICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmxpc3RQYXJ0c1F1ZXJ5KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHVwbG9hZElkLCBtYXJrZXIpXG4gICAgICBtYXJrZXIgPSByZXN1bHQubWFya2VyXG4gICAgICBwYXJ0cy5wdXNoKC4uLnJlc3VsdC5wYXJ0cylcbiAgICB9IHdoaWxlIChyZXN1bHQuaXNUcnVuY2F0ZWQpXG5cbiAgICByZXR1cm4gcGFydHNcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgYnkgbGlzdFBhcnRzIHRvIGZldGNoIGEgYmF0Y2ggb2YgcGFydC1pbmZvXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGxpc3RQYXJ0c1F1ZXJ5KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCB1cGxvYWRJZDogc3RyaW5nLCBtYXJrZXI6IG51bWJlcikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihtYXJrZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmICghdXBsb2FkSWQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3VwbG9hZElkIGNhbm5vdCBiZSBlbXB0eScpXG4gICAgfVxuXG4gICAgbGV0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXJpRXNjYXBlKHVwbG9hZElkKX1gXG4gICAgaWYgKG1hcmtlcikge1xuICAgICAgcXVlcnkgKz0gYCZwYXJ0LW51bWJlci1tYXJrZXI9JHttYXJrZXJ9YFxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlTGlzdFBhcnRzKGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpKVxuICB9XG5cbiAgYXN5bmMgbGlzdEJ1Y2tldHMoKTogUHJvbWlzZTxCdWNrZXRJdGVtRnJvbUxpc3RbXT4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcmVnaW9uQ29uZiA9IHRoaXMucmVnaW9uIHx8IERFRkFVTFRfUkVHSU9OXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCB9LCAnJywgWzIwMF0sIHJlZ2lvbkNvbmYpXG4gICAgY29uc3QgeG1sUmVzdWx0ID0gYXdhaXQgcmVhZEFzU3RyaW5nKGh0dHBSZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaXN0QnVja2V0KHhtbFJlc3VsdClcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGUgcGFydCBzaXplIGdpdmVuIHRoZSBvYmplY3Qgc2l6ZS4gUGFydCBzaXplIHdpbGwgYmUgYXRsZWFzdCB0aGlzLnBhcnRTaXplXG4gICAqL1xuICBjYWxjdWxhdGVQYXJ0U2l6ZShzaXplOiBudW1iZXIpIHtcbiAgICBpZiAoIWlzTnVtYmVyKHNpemUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzaXplIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAoc2l6ZSA+IHRoaXMubWF4T2JqZWN0U2l6ZSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgc2l6ZSBzaG91bGQgbm90IGJlIG1vcmUgdGhhbiAke3RoaXMubWF4T2JqZWN0U2l6ZX1gKVxuICAgIH1cbiAgICBpZiAodGhpcy5vdmVyUmlkZVBhcnRTaXplKSB7XG4gICAgICByZXR1cm4gdGhpcy5wYXJ0U2l6ZVxuICAgIH1cbiAgICBsZXQgcGFydFNpemUgPSB0aGlzLnBhcnRTaXplXG4gICAgZm9yICg7Oykge1xuICAgICAgLy8gd2hpbGUodHJ1ZSkgey4uLn0gdGhyb3dzIGxpbnRpbmcgZXJyb3IuXG4gICAgICAvLyBJZiBwYXJ0U2l6ZSBpcyBiaWcgZW5vdWdoIHRvIGFjY29tb2RhdGUgdGhlIG9iamVjdCBzaXplLCB0aGVuIHVzZSBpdC5cbiAgICAgIGlmIChwYXJ0U2l6ZSAqIDEwMDAwID4gc2l6ZSkge1xuICAgICAgICByZXR1cm4gcGFydFNpemVcbiAgICAgIH1cbiAgICAgIC8vIFRyeSBwYXJ0IHNpemVzIGFzIDY0TUIsIDgwTUIsIDk2TUIgZXRjLlxuICAgICAgcGFydFNpemUgKz0gMTYgKiAxMDI0ICogMTAyNFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVcGxvYWRzIHRoZSBvYmplY3QgdXNpbmcgY29udGVudHMgZnJvbSBhIGZpbGVcbiAgICovXG4gIGFzeW5jIGZQdXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIG1ldGFEYXRhOiBPYmplY3RNZXRhRGF0YSA9IHt9KSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIWlzU3RyaW5nKGZpbGVQYXRoKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZmlsZVBhdGggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QobWV0YURhdGEpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtZXRhRGF0YSBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICAvLyBJbnNlcnRzIGNvcnJlY3QgYGNvbnRlbnQtdHlwZWAgYXR0cmlidXRlIGJhc2VkIG9uIG1ldGFEYXRhIGFuZCBmaWxlUGF0aFxuICAgIG1ldGFEYXRhID0gaW5zZXJ0Q29udGVudFR5cGUobWV0YURhdGEsIGZpbGVQYXRoKVxuICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmc3AubHN0YXQoZmlsZVBhdGgpXG4gICAgYXdhaXQgdGhpcy5wdXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZnMuY3JlYXRlUmVhZFN0cmVhbShmaWxlUGF0aCksIHN0YXQuc2l6ZSwgbWV0YURhdGEpXG4gIH1cblxuICAvKipcbiAgICogIFVwbG9hZGluZyBhIHN0cmVhbSwgXCJCdWZmZXJcIiBvciBcInN0cmluZ1wiLlxuICAgKiAgSXQncyByZWNvbW1lbmRlZCB0byBwYXNzIGBzaXplYCBhcmd1bWVudCB3aXRoIHN0cmVhbS5cbiAgICovXG4gIGFzeW5jIHB1dE9iamVjdChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlIHwgQnVmZmVyIHwgc3RyaW5nLFxuICAgIHNpemU/OiBudW1iZXIsXG4gICAgbWV0YURhdGE/OiBJdGVtQnVja2V0TWV0YWRhdGEsXG4gICk6IFByb21pc2U8VXBsb2FkZWRPYmplY3RJbmZvPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICAvLyBXZSdsbCBuZWVkIHRvIHNoaWZ0IGFyZ3VtZW50cyB0byB0aGUgbGVmdCBiZWNhdXNlIG9mIG1ldGFEYXRhXG4gICAgLy8gYW5kIHNpemUgYmVpbmcgb3B0aW9uYWwuXG4gICAgaWYgKGlzT2JqZWN0KHNpemUpKSB7XG4gICAgICBtZXRhRGF0YSA9IHNpemVcbiAgICB9XG4gICAgLy8gRW5zdXJlcyBNZXRhZGF0YSBoYXMgYXBwcm9wcmlhdGUgcHJlZml4IGZvciBBMyBBUElcbiAgICBjb25zdCBoZWFkZXJzID0gcHJlcGVuZFhBTVpNZXRhKG1ldGFEYXRhKVxuICAgIGlmICh0eXBlb2Ygc3RyZWFtID09PSAnc3RyaW5nJyB8fCBzdHJlYW0gaW5zdGFuY2VvZiBCdWZmZXIpIHtcbiAgICAgIC8vIEFkYXB0cyB0aGUgbm9uLXN0cmVhbSBpbnRlcmZhY2UgaW50byBhIHN0cmVhbS5cbiAgICAgIHNpemUgPSBzdHJlYW0ubGVuZ3RoXG4gICAgICBzdHJlYW0gPSByZWFkYWJsZVN0cmVhbShzdHJlYW0pXG4gICAgfSBlbHNlIGlmICghaXNSZWFkYWJsZVN0cmVhbShzdHJlYW0pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd0aGlyZCBhcmd1bWVudCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmVhbS5SZWFkYWJsZVwiIG9yIFwiQnVmZmVyXCIgb3IgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgaWYgKGlzTnVtYmVyKHNpemUpICYmIHNpemUgPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBzaXplIGNhbm5vdCBiZSBuZWdhdGl2ZSwgZ2l2ZW4gc2l6ZTogJHtzaXplfWApXG4gICAgfVxuXG4gICAgLy8gR2V0IHRoZSBwYXJ0IHNpemUgYW5kIGZvcndhcmQgdGhhdCB0byB0aGUgQmxvY2tTdHJlYW0uIERlZmF1bHQgdG8gdGhlXG4gICAgLy8gbGFyZ2VzdCBibG9jayBzaXplIHBvc3NpYmxlIGlmIG5lY2Vzc2FyeS5cbiAgICBpZiAoIWlzTnVtYmVyKHNpemUpKSB7XG4gICAgICBzaXplID0gdGhpcy5tYXhPYmplY3RTaXplXG4gICAgfVxuXG4gICAgLy8gR2V0IHRoZSBwYXJ0IHNpemUgYW5kIGZvcndhcmQgdGhhdCB0byB0aGUgQmxvY2tTdHJlYW0uIERlZmF1bHQgdG8gdGhlXG4gICAgLy8gbGFyZ2VzdCBibG9jayBzaXplIHBvc3NpYmxlIGlmIG5lY2Vzc2FyeS5cbiAgICBpZiAoc2l6ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBzdGF0U2l6ZSA9IGF3YWl0IGdldENvbnRlbnRMZW5ndGgoc3RyZWFtKVxuICAgICAgaWYgKHN0YXRTaXplICE9PSBudWxsKSB7XG4gICAgICAgIHNpemUgPSBzdGF0U2l6ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghaXNOdW1iZXIoc2l6ZSkpIHtcbiAgICAgIC8vIEJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIHNpemUgPSB0aGlzLm1heE9iamVjdFNpemVcbiAgICB9XG5cbiAgICBjb25zdCBwYXJ0U2l6ZSA9IHRoaXMuY2FsY3VsYXRlUGFydFNpemUoc2l6ZSlcbiAgICBpZiAodHlwZW9mIHN0cmVhbSA9PT0gJ3N0cmluZycgfHwgQnVmZmVyLmlzQnVmZmVyKHN0cmVhbSkgfHwgc2l6ZSA8PSBwYXJ0U2l6ZSkge1xuICAgICAgY29uc3QgYnVmID0gaXNSZWFkYWJsZVN0cmVhbShzdHJlYW0pID8gYXdhaXQgcmVhZEFzQnVmZmVyKHN0cmVhbSkgOiBCdWZmZXIuZnJvbShzdHJlYW0pXG4gICAgICByZXR1cm4gdGhpcy51cGxvYWRCdWZmZXIoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycywgYnVmKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnVwbG9hZFN0cmVhbShidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBzdHJlYW0sIHBhcnRTaXplKVxuICB9XG5cbiAgLyoqXG4gICAqIG1ldGhvZCB0byB1cGxvYWQgYnVmZmVyIGluIG9uZSBjYWxsXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHVwbG9hZEJ1ZmZlcihcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzLFxuICAgIGJ1ZjogQnVmZmVyLFxuICApOiBQcm9taXNlPFVwbG9hZGVkT2JqZWN0SW5mbz4ge1xuICAgIGNvbnN0IHsgbWQ1c3VtLCBzaGEyNTZzdW0gfSA9IGhhc2hCaW5hcnkoYnVmLCB0aGlzLmVuYWJsZVNIQTI1NilcbiAgICBoZWFkZXJzWydDb250ZW50LUxlbmd0aCddID0gYnVmLmxlbmd0aFxuICAgIGlmICghdGhpcy5lbmFibGVTSEEyNTYpIHtcbiAgICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSBtZDVzdW1cbiAgICB9XG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdFN0cmVhbUFzeW5jKFxuICAgICAge1xuICAgICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgICBidWNrZXROYW1lLFxuICAgICAgICBvYmplY3ROYW1lLFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgfSxcbiAgICAgIGJ1ZixcbiAgICAgIHNoYTI1NnN1bSxcbiAgICAgIFsyMDBdLFxuICAgICAgJycsXG4gICAgKVxuICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxuICAgIHJldHVybiB7XG4gICAgICBldGFnOiBzYW5pdGl6ZUVUYWcocmVzLmhlYWRlcnMuZXRhZyksXG4gICAgICB2ZXJzaW9uSWQ6IGdldFZlcnNpb25JZChyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIHVwbG9hZCBzdHJlYW0gd2l0aCBNdWx0aXBhcnRVcGxvYWRcbiAgICogQHByaXZhdGVcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgdXBsb2FkU3RyZWFtKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMsXG4gICAgYm9keTogc3RyZWFtLlJlYWRhYmxlLFxuICAgIHBhcnRTaXplOiBudW1iZXIsXG4gICk6IFByb21pc2U8VXBsb2FkZWRPYmplY3RJbmZvPiB7XG4gICAgLy8gQSBtYXAgb2YgdGhlIHByZXZpb3VzbHkgdXBsb2FkZWQgY2h1bmtzLCBmb3IgcmVzdW1pbmcgYSBmaWxlIHVwbG9hZC4gVGhpc1xuICAgIC8vIHdpbGwgYmUgbnVsbCBpZiB3ZSBhcmVuJ3QgcmVzdW1pbmcgYW4gdXBsb2FkLlxuICAgIGNvbnN0IG9sZFBhcnRzOiBSZWNvcmQ8bnVtYmVyLCBQYXJ0PiA9IHt9XG5cbiAgICAvLyBLZWVwIHRyYWNrIG9mIHRoZSBldGFncyBmb3IgYWdncmVnYXRpbmcgdGhlIGNodW5rcyB0b2dldGhlciBsYXRlci4gRWFjaFxuICAgIC8vIGV0YWcgcmVwcmVzZW50cyBhIHNpbmdsZSBjaHVuayBvZiB0aGUgZmlsZS5cbiAgICBjb25zdCBlVGFnczogUGFydFtdID0gW11cblxuICAgIGNvbnN0IHByZXZpb3VzVXBsb2FkSWQgPSBhd2FpdCB0aGlzLmZpbmRVcGxvYWRJZChidWNrZXROYW1lLCBvYmplY3ROYW1lKVxuICAgIGxldCB1cGxvYWRJZDogc3RyaW5nXG4gICAgaWYgKCFwcmV2aW91c1VwbG9hZElkKSB7XG4gICAgICB1cGxvYWRJZCA9IGF3YWl0IHRoaXMuaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycylcbiAgICB9IGVsc2Uge1xuICAgICAgdXBsb2FkSWQgPSBwcmV2aW91c1VwbG9hZElkXG4gICAgICBjb25zdCBvbGRUYWdzID0gYXdhaXQgdGhpcy5saXN0UGFydHMoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcHJldmlvdXNVcGxvYWRJZClcbiAgICAgIG9sZFRhZ3MuZm9yRWFjaCgoZSkgPT4ge1xuICAgICAgICBvbGRUYWdzW2UucGFydF0gPSBlXG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IGNodW5raWVyID0gbmV3IEJsb2NrU3RyZWFtMih7IHNpemU6IHBhcnRTaXplLCB6ZXJvUGFkZGluZzogZmFsc2UgfSlcblxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tdW51c2VkLXZhcnNcbiAgICBjb25zdCBbXywgb10gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGJvZHkucGlwZShjaHVua2llcikub24oJ2Vycm9yJywgcmVqZWN0KVxuICAgICAgICBjaHVua2llci5vbignZW5kJywgcmVzb2x2ZSkub24oJ2Vycm9yJywgcmVqZWN0KVxuICAgICAgfSksXG4gICAgICAoYXN5bmMgKCkgPT4ge1xuICAgICAgICBsZXQgcGFydE51bWJlciA9IDFcblxuICAgICAgICBmb3IgYXdhaXQgKGNvbnN0IGNodW5rIG9mIGNodW5raWVyKSB7XG4gICAgICAgICAgY29uc3QgbWQ1ID0gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShjaHVuaykuZGlnZXN0KClcblxuICAgICAgICAgIGNvbnN0IG9sZFBhcnQgPSBvbGRQYXJ0c1twYXJ0TnVtYmVyXVxuICAgICAgICAgIGlmIChvbGRQYXJ0KSB7XG4gICAgICAgICAgICBpZiAob2xkUGFydC5ldGFnID09PSBtZDUudG9TdHJpbmcoJ2hleCcpKSB7XG4gICAgICAgICAgICAgIGVUYWdzLnB1c2goeyBwYXJ0OiBwYXJ0TnVtYmVyLCBldGFnOiBvbGRQYXJ0LmV0YWcgfSlcbiAgICAgICAgICAgICAgcGFydE51bWJlcisrXG4gICAgICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcGFydE51bWJlcisrXG5cbiAgICAgICAgICAvLyBub3cgc3RhcnQgdG8gdXBsb2FkIG1pc3NpbmcgcGFydFxuICAgICAgICAgIGNvbnN0IG9wdGlvbnM6IFJlcXVlc3RPcHRpb24gPSB7XG4gICAgICAgICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgICAgICAgcXVlcnk6IHFzLnN0cmluZ2lmeSh7IHBhcnROdW1iZXIsIHVwbG9hZElkIH0pLFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAnQ29udGVudC1MZW5ndGgnOiBjaHVuay5sZW5ndGgsXG4gICAgICAgICAgICAgICdDb250ZW50LU1ENSc6IG1kNS50b1N0cmluZygnYmFzZTY0JyksXG4gICAgICAgICAgICAgIC4uLmhlYWRlcnMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYnVja2V0TmFtZSxcbiAgICAgICAgICAgIG9iamVjdE5hbWUsXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KG9wdGlvbnMsIGNodW5rKVxuXG4gICAgICAgICAgbGV0IGV0YWcgPSByZXNwb25zZS5oZWFkZXJzLmV0YWdcbiAgICAgICAgICBpZiAoZXRhZykge1xuICAgICAgICAgICAgZXRhZyA9IGV0YWcucmVwbGFjZSgvXlwiLywgJycpLnJlcGxhY2UoL1wiJC8sICcnKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBldGFnID0gJydcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBlVGFncy5wdXNoKHsgcGFydDogcGFydE51bWJlciwgZXRhZyB9KVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29tcGxldGVNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdXBsb2FkSWQsIGVUYWdzKVxuICAgICAgfSkoKSxcbiAgICBdKVxuXG4gICAgcmV0dXJuIG9cbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD5cbiAgcmVtb3ZlQnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCBjYWxsYmFjazogTm9SZXN1bHRDYWxsYmFjayk6IHZvaWRcbiAgYXN5bmMgcmVtb3ZlQnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9ICdyZXBsaWNhdGlvbidcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMCwgMjA0XSwgJycpXG4gIH1cblxuICBzZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIHJlcGxpY2F0aW9uQ29uZmlnOiBSZXBsaWNhdGlvbkNvbmZpZ09wdHMpOiB2b2lkXG4gIGFzeW5jIHNldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgcmVwbGljYXRpb25Db25maWc6IFJlcGxpY2F0aW9uQ29uZmlnT3B0cyk6IFByb21pc2U8dm9pZD5cbiAgYXN5bmMgc2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCByZXBsaWNhdGlvbkNvbmZpZzogUmVwbGljYXRpb25Db25maWdPcHRzKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChyZXBsaWNhdGlvbkNvbmZpZykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JlcGxpY2F0aW9uQ29uZmlnIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoXy5pc0VtcHR5KHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ1JvbGUgY2Fubm90IGJlIGVtcHR5JylcbiAgICAgIH0gZWxzZSBpZiAocmVwbGljYXRpb25Db25maWcucm9sZSAmJiAhaXNTdHJpbmcocmVwbGljYXRpb25Db25maWcucm9sZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW52YWxpZCB2YWx1ZSBmb3Igcm9sZScsIHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUpXG4gICAgICB9XG4gICAgICBpZiAoXy5pc0VtcHR5KHJlcGxpY2F0aW9uQ29uZmlnLnJ1bGVzKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdNaW5pbXVtIG9uZSByZXBsaWNhdGlvbiBydWxlIG11c3QgYmUgc3BlY2lmaWVkJylcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICdyZXBsaWNhdGlvbidcbiAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cblxuICAgIGNvbnN0IHJlcGxpY2F0aW9uUGFyYW1zQ29uZmlnID0ge1xuICAgICAgUmVwbGljYXRpb25Db25maWd1cmF0aW9uOiB7XG4gICAgICAgIFJvbGU6IHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUsXG4gICAgICAgIFJ1bGU6IHJlcGxpY2F0aW9uQ29uZmlnLnJ1bGVzLFxuICAgICAgfSxcbiAgICB9XG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHsgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QocmVwbGljYXRpb25QYXJhbXNDb25maWcpXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgfVxuXG4gIGdldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZyk6IHZvaWRcbiAgYXN5bmMgZ2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxSZXBsaWNhdGlvbkNvbmZpZz5cbiAgYXN5bmMgZ2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdyZXBsaWNhdGlvbidcblxuICAgIGNvbnN0IGh0dHBSZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwLCAyMDRdKVxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlUmVwbGljYXRpb25Db25maWcoeG1sUmVzdWx0KVxuICB9XG5cbiAgZ2V0T2JqZWN0TGVnYWxIb2xkKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZ2V0T3B0cz86IEdldE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXG4gICAgY2FsbGJhY2s/OiBSZXN1bHRDYWxsYmFjazxMRUdBTF9IT0xEX1NUQVRVUz4sXG4gICk6IFByb21pc2U8TEVHQUxfSE9MRF9TVEFUVVM+XG4gIGFzeW5jIGdldE9iamVjdExlZ2FsSG9sZChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGdldE9wdHM/OiBHZXRPYmplY3RMZWdhbEhvbGRPcHRpb25zLFxuICApOiBQcm9taXNlPExFR0FMX0hPTERfU1RBVFVTPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoZ2V0T3B0cykge1xuICAgICAgaWYgKCFpc09iamVjdChnZXRPcHRzKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdnZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwiT2JqZWN0XCInKVxuICAgICAgfSBlbHNlIGlmIChPYmplY3Qua2V5cyhnZXRPcHRzKS5sZW5ndGggPiAwICYmIGdldE9wdHMudmVyc2lvbklkICYmICFpc1N0cmluZyhnZXRPcHRzLnZlcnNpb25JZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmVyc2lvbklkIHNob3VsZCBiZSBvZiB0eXBlIHN0cmluZy46JywgZ2V0T3B0cy52ZXJzaW9uSWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBsZXQgcXVlcnkgPSAnbGVnYWwtaG9sZCdcblxuICAgIGlmIChnZXRPcHRzPy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7Z2V0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cblxuICAgIGNvbnN0IGh0dHBSZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwXSlcbiAgICBjb25zdCBzdHJSZXMgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcbiAgICByZXR1cm4gcGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWcoc3RyUmVzKVxuICB9XG5cbiAgc2V0T2JqZWN0TGVnYWxIb2xkKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBzZXRPcHRzPzogUHV0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyk6IHZvaWRcbiAgYXN5bmMgc2V0T2JqZWN0TGVnYWxIb2xkKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgc2V0T3B0cyA9IHtcbiAgICAgIHN0YXR1czogTEVHQUxfSE9MRF9TVEFUVVMuRU5BQkxFRCxcbiAgICB9IGFzIFB1dE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCFpc09iamVjdChzZXRPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc2V0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIk9iamVjdFwiJylcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCFbTEVHQUxfSE9MRF9TVEFUVVMuRU5BQkxFRCwgTEVHQUxfSE9MRF9TVEFUVVMuRElTQUJMRURdLmluY2x1ZGVzKHNldE9wdHM/LnN0YXR1cykpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignSW52YWxpZCBzdGF0dXM6ICcgKyBzZXRPcHRzLnN0YXR1cylcbiAgICAgIH1cbiAgICAgIGlmIChzZXRPcHRzLnZlcnNpb25JZCAmJiAhc2V0T3B0cy52ZXJzaW9uSWQubGVuZ3RoKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZlcnNpb25JZCBzaG91bGQgYmUgb2YgdHlwZSBzdHJpbmcuOicgKyBzZXRPcHRzLnZlcnNpb25JZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGxldCBxdWVyeSA9ICdsZWdhbC1ob2xkJ1xuXG4gICAgaWYgKHNldE9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSArPSBgJnZlcnNpb25JZD0ke3NldE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG5cbiAgICBjb25zdCBjb25maWcgPSB7XG4gICAgICBTdGF0dXM6IHNldE9wdHMuc3RhdHVzLFxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByb290TmFtZTogJ0xlZ2FsSG9sZCcsIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGNvbmZpZylcbiAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogR2V0IFRhZ3MgYXNzb2NpYXRlZCB3aXRoIGEgQnVja2V0XG4gICAqL1xuICBhc3luYyBnZXRCdWNrZXRUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8VGFnW10+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAndGFnZ2luZydcbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucylcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlc3BvbnNlKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlVGFnZ2luZyhib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqICBHZXQgdGhlIHRhZ3MgYXNzb2NpYXRlZCB3aXRoIGEgYnVja2V0IE9SIGFuIG9iamVjdFxuICAgKi9cbiAgYXN5bmMgZ2V0T2JqZWN0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgZ2V0T3B0czogR2V0T2JqZWN0T3B0cyA9IHt9KTogUHJvbWlzZTxUYWdbXT4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgb2JqZWN0IG5hbWU6ICcgKyBvYmplY3ROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGdldE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdnZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGlmIChnZXRPcHRzICYmIGdldE9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJ5fSZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zOiBSZXF1ZXN0T3B0aW9uID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH1cbiAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgcmVxdWVzdE9wdGlvbnNbJ29iamVjdE5hbWUnXSA9IG9iamVjdE5hbWVcbiAgICB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucylcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlc3BvbnNlKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlVGFnZ2luZyhib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqICBTZXQgdGhlIHBvbGljeSBvbiBhIGJ1Y2tldCBvciBhbiBvYmplY3QgcHJlZml4LlxuICAgKi9cbiAgYXN5bmMgc2V0QnVja2V0UG9saWN5KGJ1Y2tldE5hbWU6IHN0cmluZywgcG9saWN5OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBWYWxpZGF0ZSBhcmd1bWVudHMuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwb2xpY3kpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXRQb2xpY3lFcnJvcihgSW52YWxpZCBidWNrZXQgcG9saWN5OiAke3BvbGljeX0gLSBtdXN0IGJlIFwic3RyaW5nXCJgKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5ID0gJ3BvbGljeSdcblxuICAgIGxldCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGlmIChwb2xpY3kpIHtcbiAgICAgIG1ldGhvZCA9ICdQVVQnXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgcG9saWN5LCBbMjA0XSwgJycpXG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBwb2xpY3kgb24gYSBidWNrZXQgb3IgYW4gb2JqZWN0IHByZWZpeC5cbiAgICovXG4gIGFzeW5jIGdldEJ1Y2tldFBvbGljeShidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIC8vIFZhbGlkYXRlIGFyZ3VtZW50cy5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAncG9saWN5J1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICByZXR1cm4gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgfVxuXG4gIGFzeW5jIHB1dE9iamVjdFJldGVudGlvbihidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgcmV0ZW50aW9uT3B0czogUmV0ZW50aW9uID0ge30pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHJldGVudGlvbk9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZXRlbnRpb25PcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAocmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzICYmICFpc0Jvb2xlYW4ocmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHZhbHVlIGZvciBnb3Zlcm5hbmNlQnlwYXNzOiAke3JldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzc31gKVxuICAgICAgfVxuICAgICAgaWYgKFxuICAgICAgICByZXRlbnRpb25PcHRzLm1vZGUgJiZcbiAgICAgICAgIVtSRVRFTlRJT05fTU9ERVMuQ09NUExJQU5DRSwgUkVURU5USU9OX01PREVTLkdPVkVSTkFOQ0VdLmluY2x1ZGVzKHJldGVudGlvbk9wdHMubW9kZSlcbiAgICAgICkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIG9iamVjdCByZXRlbnRpb24gbW9kZTogJHtyZXRlbnRpb25PcHRzLm1vZGV9YClcbiAgICAgIH1cbiAgICAgIGlmIChyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZSAmJiAhaXNTdHJpbmcocmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgdmFsdWUgZm9yIHJldGFpblVudGlsRGF0ZTogJHtyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZX1gKVxuICAgICAgfVxuICAgICAgaWYgKHJldGVudGlvbk9wdHMudmVyc2lvbklkICYmICFpc1N0cmluZyhyZXRlbnRpb25PcHRzLnZlcnNpb25JZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCB2YWx1ZSBmb3IgdmVyc2lvbklkOiAke3JldGVudGlvbk9wdHMudmVyc2lvbklkfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBsZXQgcXVlcnkgPSAncmV0ZW50aW9uJ1xuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGlmIChyZXRlbnRpb25PcHRzLmdvdmVybmFuY2VCeXBhc3MpIHtcbiAgICAgIGhlYWRlcnNbJ1gtQW16LUJ5cGFzcy1Hb3Zlcm5hbmNlLVJldGVudGlvbiddID0gdHJ1ZVxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByb290TmFtZTogJ1JldGVudGlvbicsIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxuICAgIGNvbnN0IHBhcmFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG5cbiAgICBpZiAocmV0ZW50aW9uT3B0cy5tb2RlKSB7XG4gICAgICBwYXJhbXMuTW9kZSA9IHJldGVudGlvbk9wdHMubW9kZVxuICAgIH1cbiAgICBpZiAocmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUpIHtcbiAgICAgIHBhcmFtcy5SZXRhaW5VbnRpbERhdGUgPSByZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZVxuICAgIH1cbiAgICBpZiAocmV0ZW50aW9uT3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7cmV0ZW50aW9uT3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cblxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHBhcmFtcylcblxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQsIFsyMDAsIDIwNF0pXG4gIH1cblxuICBnZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZywgY2FsbGJhY2s6IFJlc3VsdENhbGxiYWNrPE9iamVjdExvY2tJbmZvPik6IHZvaWRcbiAgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcpOiB2b2lkXG4gIGFzeW5jIGdldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxPYmplY3RMb2NrSW5mbz5cbiAgYXN5bmMgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ29iamVjdC1sb2NrJ1xuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZU9iamVjdExvY2tDb25maWcoeG1sUmVzdWx0KVxuICB9XG5cbiAgc2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcsIGxvY2tDb25maWdPcHRzOiBPbWl0PE9iamVjdExvY2tJbmZvLCAnb2JqZWN0TG9ja0VuYWJsZWQnPik6IHZvaWRcbiAgYXN5bmMgc2V0T2JqZWN0TG9ja0NvbmZpZyhcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgbG9ja0NvbmZpZ09wdHM6IE9taXQ8T2JqZWN0TG9ja0luZm8sICdvYmplY3RMb2NrRW5hYmxlZCc+LFxuICApOiBQcm9taXNlPHZvaWQ+XG4gIGFzeW5jIHNldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nLCBsb2NrQ29uZmlnT3B0czogT21pdDxPYmplY3RMb2NrSW5mbywgJ29iamVjdExvY2tFbmFibGVkJz4pIHtcbiAgICBjb25zdCByZXRlbnRpb25Nb2RlcyA9IFtSRVRFTlRJT05fTU9ERVMuQ09NUExJQU5DRSwgUkVURU5USU9OX01PREVTLkdPVkVSTkFOQ0VdXG4gICAgY29uc3QgdmFsaWRVbml0cyA9IFtSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuREFZUywgUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTXVxuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG5cbiAgICBpZiAobG9ja0NvbmZpZ09wdHMubW9kZSAmJiAhcmV0ZW50aW9uTW9kZXMuaW5jbHVkZXMobG9ja0NvbmZpZ09wdHMubW9kZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLm1vZGUgc2hvdWxkIGJlIG9uZSBvZiAke3JldGVudGlvbk1vZGVzfWApXG4gICAgfVxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy51bml0ICYmICF2YWxpZFVuaXRzLmluY2x1ZGVzKGxvY2tDb25maWdPcHRzLnVuaXQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBsb2NrQ29uZmlnT3B0cy51bml0IHNob3VsZCBiZSBvbmUgb2YgJHt2YWxpZFVuaXRzfWApXG4gICAgfVxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSAmJiAhaXNOdW1iZXIobG9ja0NvbmZpZ09wdHMudmFsaWRpdHkpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSBzaG91bGQgYmUgYSBudW1iZXJgKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAnb2JqZWN0LWxvY2snXG5cbiAgICBjb25zdCBjb25maWc6IE9iamVjdExvY2tDb25maWdQYXJhbSA9IHtcbiAgICAgIE9iamVjdExvY2tFbmFibGVkOiAnRW5hYmxlZCcsXG4gICAgfVxuICAgIGNvbnN0IGNvbmZpZ0tleXMgPSBPYmplY3Qua2V5cyhsb2NrQ29uZmlnT3B0cylcblxuICAgIGNvbnN0IGlzQWxsS2V5c1NldCA9IFsndW5pdCcsICdtb2RlJywgJ3ZhbGlkaXR5J10uZXZlcnkoKGxjaykgPT4gY29uZmlnS2V5cy5pbmNsdWRlcyhsY2spKVxuICAgIC8vIENoZWNrIGlmIGtleXMgYXJlIHByZXNlbnQgYW5kIGFsbCBrZXlzIGFyZSBwcmVzZW50LlxuICAgIGlmIChjb25maWdLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmICghaXNBbGxLZXlzU2V0KSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgYGxvY2tDb25maWdPcHRzLm1vZGUsbG9ja0NvbmZpZ09wdHMudW5pdCxsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSBhbGwgdGhlIHByb3BlcnRpZXMgc2hvdWxkIGJlIHNwZWNpZmllZC5gLFxuICAgICAgICApXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25maWcuUnVsZSA9IHtcbiAgICAgICAgICBEZWZhdWx0UmV0ZW50aW9uOiB7fSxcbiAgICAgICAgfVxuICAgICAgICBpZiAobG9ja0NvbmZpZ09wdHMubW9kZSkge1xuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uTW9kZSA9IGxvY2tDb25maWdPcHRzLm1vZGVcbiAgICAgICAgfVxuICAgICAgICBpZiAobG9ja0NvbmZpZ09wdHMudW5pdCA9PT0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLkRBWVMpIHtcbiAgICAgICAgICBjb25maWcuUnVsZS5EZWZhdWx0UmV0ZW50aW9uLkRheXMgPSBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eVxuICAgICAgICB9IGVsc2UgaWYgKGxvY2tDb25maWdPcHRzLnVuaXQgPT09IFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5ZRUFSUykge1xuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uWWVhcnMgPSBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ09iamVjdExvY2tDb25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxuICB9XG5cbiAgYXN5bmMgZ2V0QnVja2V0VmVyc2lvbmluZyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPEJ1Y2tldFZlcnNpb25pbmdDb25maWd1cmF0aW9uPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICd2ZXJzaW9uaW5nJ1xuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcbiAgICByZXR1cm4gYXdhaXQgeG1sUGFyc2Vycy5wYXJzZUJ1Y2tldFZlcnNpb25pbmdDb25maWcoeG1sUmVzdWx0KVxuICB9XG5cbiAgYXN5bmMgc2V0QnVja2V0VmVyc2lvbmluZyhidWNrZXROYW1lOiBzdHJpbmcsIHZlcnNpb25Db25maWc6IEJ1Y2tldFZlcnNpb25pbmdDb25maWd1cmF0aW9uKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFPYmplY3Qua2V5cyh2ZXJzaW9uQ29uZmlnKS5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3ZlcnNpb25Db25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICd2ZXJzaW9uaW5nJ1xuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdWZXJzaW9uaW5nQ29uZmlndXJhdGlvbicsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QodmVyc2lvbkNvbmZpZylcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNldFRhZ2dpbmcodGFnZ2luZ1BhcmFtczogUHV0VGFnZ2luZ1BhcmFtcyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdGFncywgcHV0T3B0cyB9ID0gdGFnZ2luZ1BhcmFtc1xuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG5cbiAgICBpZiAocHV0T3B0cyAmJiBwdXRPcHRzPy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke3B1dE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgdGFnc0xpc3QgPSBbXVxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHRhZ3MpKSB7XG4gICAgICB0YWdzTGlzdC5wdXNoKHsgS2V5OiBrZXksIFZhbHVlOiB2YWx1ZSB9KVxuICAgIH1cbiAgICBjb25zdCB0YWdnaW5nQ29uZmlnID0ge1xuICAgICAgVGFnZ2luZzoge1xuICAgICAgICBUYWdTZXQ6IHtcbiAgICAgICAgICBUYWc6IHRhZ3NMaXN0LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9XG4gICAgY29uc3QgaGVhZGVycyA9IHt9IGFzIFJlcXVlc3RIZWFkZXJzXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IGhlYWRsZXNzOiB0cnVlLCByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSB9KVxuICAgIGNvbnN0IHBheWxvYWRCdWYgPSBCdWZmZXIuZnJvbShidWlsZGVyLmJ1aWxkT2JqZWN0KHRhZ2dpbmdDb25maWcpKVxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0ge1xuICAgICAgbWV0aG9kLFxuICAgICAgYnVja2V0TmFtZSxcbiAgICAgIHF1ZXJ5LFxuICAgICAgaGVhZGVycyxcblxuICAgICAgLi4uKG9iamVjdE5hbWUgJiYgeyBvYmplY3ROYW1lOiBvYmplY3ROYW1lIH0pLFxuICAgIH1cblxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkQnVmKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChyZXF1ZXN0T3B0aW9ucywgcGF5bG9hZEJ1ZilcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVtb3ZlVGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHJlbW92ZU9wdHMgfTogUmVtb3ZlVGFnZ2luZ1BhcmFtcyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG5cbiAgICBpZiAocmVtb3ZlT3B0cyAmJiBPYmplY3Qua2V5cyhyZW1vdmVPcHRzKS5sZW5ndGggJiYgcmVtb3ZlT3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke3JlbW92ZU9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfVxuXG4gICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgIHJlcXVlc3RPcHRpb25zWydvYmplY3ROYW1lJ10gPSBvYmplY3ROYW1lXG4gICAgfVxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucywgJycsIFsyMDAsIDIwNF0pXG4gIH1cblxuICBhc3luYyBzZXRCdWNrZXRUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgdGFnczogVGFncyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QodGFncykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3RhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmIChPYmplY3Qua2V5cyh0YWdzKS5sZW5ndGggPiAxMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignbWF4aW11bSB0YWdzIGFsbG93ZWQgaXMgMTBcIicpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zZXRUYWdnaW5nKHsgYnVja2V0TmFtZSwgdGFncyB9KVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBhd2FpdCB0aGlzLnJlbW92ZVRhZ2dpbmcoeyBidWNrZXROYW1lIH0pXG4gIH1cblxuICBhc3luYyBzZXRPYmplY3RUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCB0YWdzOiBUYWdzLCBwdXRPcHRzOiBUYWdnaW5nT3B0cykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBvYmplY3QgbmFtZTogJyArIG9iamVjdE5hbWUpXG4gICAgfVxuXG4gICAgaWYgKCFpc09iamVjdCh0YWdzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndGFncyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKE9iamVjdC5rZXlzKHRhZ3MpLmxlbmd0aCA+IDEwKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdNYXhpbXVtIHRhZ3MgYWxsb3dlZCBpcyAxMFwiJylcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNldFRhZ2dpbmcoeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCB0YWdzLCBwdXRPcHRzIH0pXG4gIH1cblxuICBhc3luYyByZW1vdmVPYmplY3RUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCByZW1vdmVPcHRzOiBUYWdnaW5nT3B0cykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBvYmplY3QgbmFtZTogJyArIG9iamVjdE5hbWUpXG4gICAgfVxuICAgIGlmIChyZW1vdmVPcHRzICYmIE9iamVjdC5rZXlzKHJlbW92ZU9wdHMpLmxlbmd0aCAmJiAhaXNPYmplY3QocmVtb3ZlT3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JlbW92ZU9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5yZW1vdmVUYWdnaW5nKHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcmVtb3ZlT3B0cyB9KVxuICB9XG5cbiAgYXN5bmMgc2VsZWN0T2JqZWN0Q29udGVudChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIHNlbGVjdE9wdHM6IFNlbGVjdE9wdGlvbnMsXG4gICk6IFByb21pc2U8U2VsZWN0UmVzdWx0cyB8IHVuZGVmaW5lZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghXy5pc0VtcHR5KHNlbGVjdE9wdHMpKSB7XG4gICAgICBpZiAoIWlzU3RyaW5nKHNlbGVjdE9wdHMuZXhwcmVzc2lvbikpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3FsRXhwcmVzc2lvbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICAgIH1cbiAgICAgIGlmICghXy5pc0VtcHR5KHNlbGVjdE9wdHMuaW5wdXRTZXJpYWxpemF0aW9uKSkge1xuICAgICAgICBpZiAoIWlzT2JqZWN0KHNlbGVjdE9wdHMuaW5wdXRTZXJpYWxpemF0aW9uKSkge1xuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2lucHV0U2VyaWFsaXphdGlvbiBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignaW5wdXRTZXJpYWxpemF0aW9uIGlzIHJlcXVpcmVkJylcbiAgICAgIH1cbiAgICAgIGlmICghXy5pc0VtcHR5KHNlbGVjdE9wdHMub3V0cHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgaWYgKCFpc09iamVjdChzZWxlY3RPcHRzLm91dHB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3V0cHV0U2VyaWFsaXphdGlvbiBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3V0cHV0U2VyaWFsaXphdGlvbiBpcyByZXF1aXJlZCcpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZhbGlkIHNlbGVjdCBjb25maWd1cmF0aW9uIGlzIHJlcXVpcmVkJylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUE9TVCdcbiAgICBjb25zdCBxdWVyeSA9IGBzZWxlY3Qmc2VsZWN0LXR5cGU9MmBcblxuICAgIGNvbnN0IGNvbmZpZzogUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXSA9IFtcbiAgICAgIHtcbiAgICAgICAgRXhwcmVzc2lvbjogc2VsZWN0T3B0cy5leHByZXNzaW9uLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgRXhwcmVzc2lvblR5cGU6IHNlbGVjdE9wdHMuZXhwcmVzc2lvblR5cGUgfHwgJ1NRTCcsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBJbnB1dFNlcmlhbGl6YXRpb246IFtzZWxlY3RPcHRzLmlucHV0U2VyaWFsaXphdGlvbl0sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBPdXRwdXRTZXJpYWxpemF0aW9uOiBbc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uXSxcbiAgICAgIH0sXG4gICAgXVxuXG4gICAgLy8gT3B0aW9uYWxcbiAgICBpZiAoc2VsZWN0T3B0cy5yZXF1ZXN0UHJvZ3Jlc3MpIHtcbiAgICAgIGNvbmZpZy5wdXNoKHsgUmVxdWVzdFByb2dyZXNzOiBzZWxlY3RPcHRzPy5yZXF1ZXN0UHJvZ3Jlc3MgfSlcbiAgICB9XG4gICAgLy8gT3B0aW9uYWxcbiAgICBpZiAoc2VsZWN0T3B0cy5zY2FuUmFuZ2UpIHtcbiAgICAgIGNvbmZpZy5wdXNoKHsgU2NhblJhbmdlOiBzZWxlY3RPcHRzLnNjYW5SYW5nZSB9KVxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdTZWxlY3RPYmplY3RDb250ZW50UmVxdWVzdCcsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCBwYXlsb2FkKVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNCdWZmZXIocmVzKVxuICAgIHJldHVybiBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZShib2R5KVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBhcHBseUJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lOiBzdHJpbmcsIHBvbGljeUNvbmZpZzogTGlmZUN5Y2xlQ29uZmlnUGFyYW0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xpZmVjeWNsZSdcblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnTGlmZWN5Y2xlQ29uZmlndXJhdGlvbicsXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QocG9saWN5Q29uZmlnKVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xpZmVjeWNsZSdcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwNF0pXG4gIH1cblxuICBhc3luYyBzZXRCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZTogc3RyaW5nLCBsaWZlQ3ljbGVDb25maWc6IExpZmVDeWNsZUNvbmZpZ1BhcmFtKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKF8uaXNFbXB0eShsaWZlQ3ljbGVDb25maWcpKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbW92ZUJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lKVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLmFwcGx5QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWUsIGxpZmVDeWNsZUNvbmZpZylcbiAgICB9XG4gIH1cblxuICBhc3luYyBnZXRCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxMaWZlY3ljbGVDb25maWcgfCBudWxsPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdsaWZlY3ljbGUnXG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaWZlY3ljbGVDb25maWcoYm9keSlcbiAgfVxuXG4gIGFzeW5jIHNldEJ1Y2tldEVuY3J5cHRpb24oYnVja2V0TmFtZTogc3RyaW5nLCBlbmNyeXB0aW9uQ29uZmlnPzogRW5jcnlwdGlvbkNvbmZpZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghXy5pc0VtcHR5KGVuY3J5cHRpb25Db25maWcpICYmIGVuY3J5cHRpb25Db25maWcuUnVsZS5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnZhbGlkIFJ1bGUgbGVuZ3RoLiBPbmx5IG9uZSBydWxlIGlzIGFsbG93ZWQuOiAnICsgZW5jcnlwdGlvbkNvbmZpZy5SdWxlKVxuICAgIH1cblxuICAgIGxldCBlbmNyeXB0aW9uT2JqID0gZW5jcnlwdGlvbkNvbmZpZ1xuICAgIGlmIChfLmlzRW1wdHkoZW5jcnlwdGlvbkNvbmZpZykpIHtcbiAgICAgIGVuY3J5cHRpb25PYmogPSB7XG4gICAgICAgIC8vIERlZmF1bHQgTWluSU8gU2VydmVyIFN1cHBvcnRlZCBSdWxlXG4gICAgICAgIFJ1bGU6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBBcHBseVNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0OiB7XG4gICAgICAgICAgICAgIFNTRUFsZ29yaXRobTogJ0FFUzI1NicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICdlbmNyeXB0aW9uJ1xuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdTZXJ2ZXJTaWRlRW5jcnlwdGlvbkNvbmZpZ3VyYXRpb24nLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcbiAgICB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGVuY3J5cHRpb25PYmopXG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxuICB9XG5cbiAgYXN5bmMgZ2V0QnVja2V0RW5jcnlwdGlvbihidWNrZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2VuY3J5cHRpb24nXG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VCdWNrZXRFbmNyeXB0aW9uQ29uZmlnKGJvZHkpXG4gIH1cblxuICBhc3luYyByZW1vdmVCdWNrZXRFbmNyeXB0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgY29uc3QgcXVlcnkgPSAnZW5jcnlwdGlvbidcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjA0XSlcbiAgfVxuXG4gIGFzeW5jIGdldE9iamVjdFJldGVudGlvbihcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGdldE9wdHM/OiBHZXRPYmplY3RSZXRlbnRpb25PcHRzLFxuICApOiBQcm9taXNlPE9iamVjdFJldGVudGlvbkluZm8gfCBudWxsIHwgdW5kZWZpbmVkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKGdldE9wdHMgJiYgIWlzT2JqZWN0KGdldE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdnZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH0gZWxzZSBpZiAoZ2V0T3B0cz8udmVyc2lvbklkICYmICFpc1N0cmluZyhnZXRPcHRzLnZlcnNpb25JZCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3ZlcnNpb25JZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGxldCBxdWVyeSA9ICdyZXRlbnRpb24nXG4gICAgaWYgKGdldE9wdHM/LnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZU9iamVjdFJldGVudGlvbkNvbmZpZyhib2R5KVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlT2JqZWN0cyhidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdHNMaXN0OiBSZW1vdmVPYmplY3RzUGFyYW0pOiBQcm9taXNlPFJlbW92ZU9iamVjdHNSZXNwb25zZVtdPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG9iamVjdHNMaXN0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignb2JqZWN0c0xpc3Qgc2hvdWxkIGJlIGEgbGlzdCcpXG4gICAgfVxuXG4gICAgY29uc3QgcnVuRGVsZXRlT2JqZWN0cyA9IGFzeW5jIChiYXRjaDogUmVtb3ZlT2JqZWN0c1BhcmFtKTogUHJvbWlzZTxSZW1vdmVPYmplY3RzUmVzcG9uc2VbXT4gPT4ge1xuICAgICAgY29uc3QgZGVsT2JqZWN0czogUmVtb3ZlT2JqZWN0c1JlcXVlc3RFbnRyeVtdID0gYmF0Y2gubWFwKCh2YWx1ZSkgPT4ge1xuICAgICAgICByZXR1cm4gaXNPYmplY3QodmFsdWUpID8geyBLZXk6IHZhbHVlLm5hbWUsIFZlcnNpb25JZDogdmFsdWUudmVyc2lvbklkIH0gOiB7IEtleTogdmFsdWUgfVxuICAgICAgfSlcblxuICAgICAgY29uc3QgcmVtT2JqZWN0cyA9IHsgRGVsZXRlOiB7IFF1aWV0OiB0cnVlLCBPYmplY3Q6IGRlbE9iamVjdHMgfSB9XG4gICAgICBjb25zdCBwYXlsb2FkID0gQnVmZmVyLmZyb20obmV3IHhtbDJqcy5CdWlsZGVyKHsgaGVhZGxlc3M6IHRydWUgfSkuYnVpbGRPYmplY3QocmVtT2JqZWN0cykpXG4gICAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHsgJ0NvbnRlbnQtTUQ1JzogdG9NZDUocGF5bG9hZCkgfVxuXG4gICAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2Q6ICdQT1NUJywgYnVja2V0TmFtZSwgcXVlcnk6ICdkZWxldGUnLCBoZWFkZXJzIH0sIHBheWxvYWQpXG4gICAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICAgIHJldHVybiB4bWxQYXJzZXJzLnJlbW92ZU9iamVjdHNQYXJzZXIoYm9keSlcbiAgICB9XG5cbiAgICBjb25zdCBtYXhFbnRyaWVzID0gMTAwMCAvLyBtYXggZW50cmllcyBhY2NlcHRlZCBpbiBzZXJ2ZXIgZm9yIERlbGV0ZU11bHRpcGxlT2JqZWN0cyBBUEkuXG4gICAgLy8gQ2xpZW50IHNpZGUgYmF0Y2hpbmdcbiAgICBjb25zdCBiYXRjaGVzID0gW11cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG9iamVjdHNMaXN0Lmxlbmd0aDsgaSArPSBtYXhFbnRyaWVzKSB7XG4gICAgICBiYXRjaGVzLnB1c2gob2JqZWN0c0xpc3Quc2xpY2UoaSwgaSArIG1heEVudHJpZXMpKVxuICAgIH1cblxuICAgIGNvbnN0IGJhdGNoUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKGJhdGNoZXMubWFwKHJ1bkRlbGV0ZU9iamVjdHMpKVxuICAgIHJldHVybiBiYXRjaFJlc3VsdHMuZmxhdCgpXG4gIH1cblxuICBhc3luYyByZW1vdmVJbmNvbXBsZXRlVXBsb2FkKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5Jc1ZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgY29uc3QgcmVtb3ZlVXBsb2FkSWQgPSBhd2FpdCB0aGlzLmZpbmRVcGxvYWRJZChidWNrZXROYW1lLCBvYmplY3ROYW1lKVxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgY29uc3QgcXVlcnkgPSBgdXBsb2FkSWQ9JHtyZW1vdmVVcGxvYWRJZH1gXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDRdKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjb3B5T2JqZWN0VjEoXG4gICAgdGFyZ2V0QnVja2V0TmFtZTogc3RyaW5nLFxuICAgIHRhcmdldE9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGNvbmRpdGlvbnM/OiBudWxsIHwgQ29weUNvbmRpdGlvbnMsXG4gICkge1xuICAgIGlmICh0eXBlb2YgY29uZGl0aW9ucyA9PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjb25kaXRpb25zID0gbnVsbFxuICAgIH1cblxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUodGFyZ2V0QnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIHRhcmdldEJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUodGFyZ2V0T2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHt0YXJnZXRPYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lID09PSAnJykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEVtcHR5IHNvdXJjZSBwcmVmaXhgKVxuICAgIH1cblxuICAgIGlmIChjb25kaXRpb25zICE9IG51bGwgJiYgIShjb25kaXRpb25zIGluc3RhbmNlb2YgQ29weUNvbmRpdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjb25kaXRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwiQ29weUNvbmRpdGlvbnNcIicpXG4gICAgfVxuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlJ10gPSB1cmlSZXNvdXJjZUVzY2FwZShzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSlcblxuICAgIGlmIChjb25kaXRpb25zKSB7XG4gICAgICBpZiAoY29uZGl0aW9ucy5tb2RpZmllZCAhPT0gJycpIHtcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtbW9kaWZpZWQtc2luY2UnXSA9IGNvbmRpdGlvbnMubW9kaWZpZWRcbiAgICAgIH1cbiAgICAgIGlmIChjb25kaXRpb25zLnVubW9kaWZpZWQgIT09ICcnKSB7XG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLXVubW9kaWZpZWQtc2luY2UnXSA9IGNvbmRpdGlvbnMudW5tb2RpZmllZFxuICAgICAgfVxuICAgICAgaWYgKGNvbmRpdGlvbnMubWF0Y2hFVGFnICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi1tYXRjaCddID0gY29uZGl0aW9ucy5tYXRjaEVUYWdcbiAgICAgIH1cbiAgICAgIGlmIChjb25kaXRpb25zLm1hdGNoRVRhZ0V4Y2VwdCAhPT0gJycpIHtcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtbm9uZS1tYXRjaCddID0gY29uZGl0aW9ucy5tYXRjaEVUYWdFeGNlcHRcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHtcbiAgICAgIG1ldGhvZCxcbiAgICAgIGJ1Y2tldE5hbWU6IHRhcmdldEJ1Y2tldE5hbWUsXG4gICAgICBvYmplY3ROYW1lOiB0YXJnZXRPYmplY3ROYW1lLFxuICAgICAgaGVhZGVycyxcbiAgICB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlQ29weU9iamVjdChib2R5KVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjb3B5T2JqZWN0VjIoXG4gICAgc291cmNlQ29uZmlnOiBDb3B5U291cmNlT3B0aW9ucyxcbiAgICBkZXN0Q29uZmlnOiBDb3B5RGVzdGluYXRpb25PcHRpb25zLFxuICApOiBQcm9taXNlPENvcHlPYmplY3RSZXN1bHRWMj4ge1xuICAgIGlmICghKHNvdXJjZUNvbmZpZyBpbnN0YW5jZW9mIENvcHlTb3VyY2VPcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc291cmNlQ29uZmlnIHNob3VsZCBvZiB0eXBlIENvcHlTb3VyY2VPcHRpb25zICcpXG4gICAgfVxuICAgIGlmICghKGRlc3RDb25maWcgaW5zdGFuY2VvZiBDb3B5RGVzdGluYXRpb25PcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignZGVzdENvbmZpZyBzaG91bGQgb2YgdHlwZSBDb3B5RGVzdGluYXRpb25PcHRpb25zICcpXG4gICAgfVxuICAgIGlmICghZGVzdENvbmZpZy52YWxpZGF0ZSgpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoKVxuICAgIH1cbiAgICBpZiAoIWRlc3RDb25maWcudmFsaWRhdGUoKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KClcbiAgICB9XG5cbiAgICBjb25zdCBoZWFkZXJzID0gT2JqZWN0LmFzc2lnbih7fSwgc291cmNlQ29uZmlnLmdldEhlYWRlcnMoKSwgZGVzdENvbmZpZy5nZXRIZWFkZXJzKCkpXG5cbiAgICBjb25zdCBidWNrZXROYW1lID0gZGVzdENvbmZpZy5CdWNrZXRcbiAgICBjb25zdCBvYmplY3ROYW1lID0gZGVzdENvbmZpZy5PYmplY3RcblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICBjb25zdCBjb3B5UmVzID0geG1sUGFyc2Vycy5wYXJzZUNvcHlPYmplY3QoYm9keSlcbiAgICBjb25zdCByZXNIZWFkZXJzOiBJbmNvbWluZ0h0dHBIZWFkZXJzID0gcmVzLmhlYWRlcnNcblxuICAgIGNvbnN0IHNpemVIZWFkZXJWYWx1ZSA9IHJlc0hlYWRlcnMgJiYgcmVzSGVhZGVyc1snY29udGVudC1sZW5ndGgnXVxuICAgIGNvbnN0IHNpemUgPSB0eXBlb2Ygc2l6ZUhlYWRlclZhbHVlID09PSAnbnVtYmVyJyA/IHNpemVIZWFkZXJWYWx1ZSA6IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIEJ1Y2tldDogZGVzdENvbmZpZy5CdWNrZXQsXG4gICAgICBLZXk6IGRlc3RDb25maWcuT2JqZWN0LFxuICAgICAgTGFzdE1vZGlmaWVkOiBjb3B5UmVzLmxhc3RNb2RpZmllZCxcbiAgICAgIE1ldGFEYXRhOiBleHRyYWN0TWV0YWRhdGEocmVzSGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgICBWZXJzaW9uSWQ6IGdldFZlcnNpb25JZChyZXNIZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICAgIFNvdXJjZVZlcnNpb25JZDogZ2V0U291cmNlVmVyc2lvbklkKHJlc0hlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgICAgRXRhZzogc2FuaXRpemVFVGFnKHJlc0hlYWRlcnMuZXRhZyksXG4gICAgICBTaXplOiBzaXplLFxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGNvcHlPYmplY3Qoc291cmNlOiBDb3B5U291cmNlT3B0aW9ucywgZGVzdDogQ29weURlc3RpbmF0aW9uT3B0aW9ucyk6IFByb21pc2U8Q29weU9iamVjdFJlc3VsdD5cbiAgYXN5bmMgY29weU9iamVjdChcbiAgICB0YXJnZXRCdWNrZXROYW1lOiBzdHJpbmcsXG4gICAgdGFyZ2V0T2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgY29uZGl0aW9ucz86IENvcHlDb25kaXRpb25zLFxuICApOiBQcm9taXNlPENvcHlPYmplY3RSZXN1bHQ+XG4gIGFzeW5jIGNvcHlPYmplY3QoLi4uYWxsQXJnczogQ29weU9iamVjdFBhcmFtcyk6IFByb21pc2U8Q29weU9iamVjdFJlc3VsdD4ge1xuICAgIGlmICh0eXBlb2YgYWxsQXJnc1swXSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGNvbnN0IFt0YXJnZXRCdWNrZXROYW1lLCB0YXJnZXRPYmplY3ROYW1lLCBzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSwgY29uZGl0aW9uc10gPSBhbGxBcmdzIGFzIFtcbiAgICAgICAgc3RyaW5nLFxuICAgICAgICBzdHJpbmcsXG4gICAgICAgIHN0cmluZyxcbiAgICAgICAgQ29weUNvbmRpdGlvbnM/LFxuICAgICAgXVxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29weU9iamVjdFYxKHRhcmdldEJ1Y2tldE5hbWUsIHRhcmdldE9iamVjdE5hbWUsIHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lLCBjb25kaXRpb25zKVxuICAgIH1cbiAgICBjb25zdCBbc291cmNlLCBkZXN0XSA9IGFsbEFyZ3MgYXMgW0NvcHlTb3VyY2VPcHRpb25zLCBDb3B5RGVzdGluYXRpb25PcHRpb25zXVxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvcHlPYmplY3RWMihzb3VyY2UsIGRlc3QpXG4gIH1cblxuICBhc3luYyB1cGxvYWRQYXJ0KHBhcnRDb25maWc6IHtcbiAgICBidWNrZXROYW1lOiBzdHJpbmdcbiAgICBvYmplY3ROYW1lOiBzdHJpbmdcbiAgICB1cGxvYWRJRDogc3RyaW5nXG4gICAgcGFydE51bWJlcjogbnVtYmVyXG4gICAgaGVhZGVyczogUmVxdWVzdEhlYWRlcnNcbiAgfSkge1xuICAgIGNvbnN0IHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdXBsb2FkSUQsIHBhcnROdW1iZXIsIGhlYWRlcnMgfSA9IHBhcnRDb25maWdcblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cGxvYWRJRH0mcGFydE51bWJlcj0ke3BhcnROdW1iZXJ9YFxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWU6IG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH1cblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucylcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICBjb25zdCBwYXJ0UmVzID0gdXBsb2FkUGFydFBhcnNlcihib2R5KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGV0YWc6IHNhbml0aXplRVRhZyhwYXJ0UmVzLkVUYWcpLFxuICAgICAga2V5OiBvYmplY3ROYW1lLFxuICAgICAgcGFydDogcGFydE51bWJlcixcbiAgICB9XG4gIH1cblxuICBhc3luYyBjb21wb3NlT2JqZWN0KFxuICAgIGRlc3RPYmpDb25maWc6IENvcHlEZXN0aW5hdGlvbk9wdGlvbnMsXG4gICAgc291cmNlT2JqTGlzdDogQ29weVNvdXJjZU9wdGlvbnNbXSxcbiAgKTogUHJvbWlzZTxib29sZWFuIHwgeyBldGFnOiBzdHJpbmc7IHZlcnNpb25JZDogc3RyaW5nIHwgbnVsbCB9IHwgUHJvbWlzZTx2b2lkPiB8IENvcHlPYmplY3RSZXN1bHQ+IHtcbiAgICBjb25zdCBzb3VyY2VGaWxlc0xlbmd0aCA9IHNvdXJjZU9iakxpc3QubGVuZ3RoXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoc291cmNlT2JqTGlzdCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3NvdXJjZUNvbmZpZyBzaG91bGQgYW4gYXJyYXkgb2YgQ29weVNvdXJjZU9wdGlvbnMgJylcbiAgICB9XG4gICAgaWYgKCEoZGVzdE9iakNvbmZpZyBpbnN0YW5jZW9mIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdkZXN0Q29uZmlnIHNob3VsZCBvZiB0eXBlIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMgJylcbiAgICB9XG5cbiAgICBpZiAoc291cmNlRmlsZXNMZW5ndGggPCAxIHx8IHNvdXJjZUZpbGVzTGVuZ3RoID4gUEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgIGBcIlRoZXJlIG11c3QgYmUgYXMgbGVhc3Qgb25lIGFuZCB1cCB0byAke1BBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UfSBzb3VyY2Ugb2JqZWN0cy5gLFxuICAgICAgKVxuICAgIH1cblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc291cmNlRmlsZXNMZW5ndGg7IGkrKykge1xuICAgICAgY29uc3Qgc09iaiA9IHNvdXJjZU9iakxpc3RbaV0gYXMgQ29weVNvdXJjZU9wdGlvbnNcbiAgICAgIGlmICghc09iai52YWxpZGF0ZSgpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghKGRlc3RPYmpDb25maWcgYXMgQ29weURlc3RpbmF0aW9uT3B0aW9ucykudmFsaWRhdGUoKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgY29uc3QgZ2V0U3RhdE9wdGlvbnMgPSAoc3JjQ29uZmlnOiBDb3B5U291cmNlT3B0aW9ucykgPT4ge1xuICAgICAgbGV0IHN0YXRPcHRzID0ge31cbiAgICAgIGlmICghXy5pc0VtcHR5KHNyY0NvbmZpZy5WZXJzaW9uSUQpKSB7XG4gICAgICAgIHN0YXRPcHRzID0ge1xuICAgICAgICAgIHZlcnNpb25JZDogc3JjQ29uZmlnLlZlcnNpb25JRCxcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHN0YXRPcHRzXG4gICAgfVxuICAgIGNvbnN0IHNyY09iamVjdFNpemVzOiBudW1iZXJbXSA9IFtdXG4gICAgbGV0IHRvdGFsU2l6ZSA9IDBcbiAgICBsZXQgdG90YWxQYXJ0cyA9IDBcblxuICAgIGNvbnN0IHNvdXJjZU9ialN0YXRzID0gc291cmNlT2JqTGlzdC5tYXAoKHNyY0l0ZW0pID0+XG4gICAgICB0aGlzLnN0YXRPYmplY3Qoc3JjSXRlbS5CdWNrZXQsIHNyY0l0ZW0uT2JqZWN0LCBnZXRTdGF0T3B0aW9ucyhzcmNJdGVtKSksXG4gICAgKVxuXG4gICAgY29uc3Qgc3JjT2JqZWN0SW5mb3MgPSBhd2FpdCBQcm9taXNlLmFsbChzb3VyY2VPYmpTdGF0cylcblxuICAgIGNvbnN0IHZhbGlkYXRlZFN0YXRzID0gc3JjT2JqZWN0SW5mb3MubWFwKChyZXNJdGVtU3RhdCwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IHNyY0NvbmZpZzogQ29weVNvdXJjZU9wdGlvbnMgfCB1bmRlZmluZWQgPSBzb3VyY2VPYmpMaXN0W2luZGV4XVxuXG4gICAgICBsZXQgc3JjQ29weVNpemUgPSByZXNJdGVtU3RhdC5zaXplXG4gICAgICAvLyBDaGVjayBpZiBhIHNlZ21lbnQgaXMgc3BlY2lmaWVkLCBhbmQgaWYgc28sIGlzIHRoZVxuICAgICAgLy8gc2VnbWVudCB3aXRoaW4gb2JqZWN0IGJvdW5kcz9cbiAgICAgIGlmIChzcmNDb25maWcgJiYgc3JjQ29uZmlnLk1hdGNoUmFuZ2UpIHtcbiAgICAgICAgLy8gU2luY2UgcmFuZ2UgaXMgc3BlY2lmaWVkLFxuICAgICAgICAvLyAgICAwIDw9IHNyYy5zcmNTdGFydCA8PSBzcmMuc3JjRW5kXG4gICAgICAgIC8vIHNvIG9ubHkgaW52YWxpZCBjYXNlIHRvIGNoZWNrIGlzOlxuICAgICAgICBjb25zdCBzcmNTdGFydCA9IHNyY0NvbmZpZy5TdGFydFxuICAgICAgICBjb25zdCBzcmNFbmQgPSBzcmNDb25maWcuRW5kXG4gICAgICAgIGlmIChzcmNFbmQgPj0gc3JjQ29weVNpemUgfHwgc3JjU3RhcnQgPCAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICAgIGBDb3B5U3JjT3B0aW9ucyAke2luZGV4fSBoYXMgaW52YWxpZCBzZWdtZW50LXRvLWNvcHkgWyR7c3JjU3RhcnR9LCAke3NyY0VuZH1dIChzaXplIGlzICR7c3JjQ29weVNpemV9KWAsXG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICAgIHNyY0NvcHlTaXplID0gc3JjRW5kIC0gc3JjU3RhcnQgKyAxXG4gICAgICB9XG5cbiAgICAgIC8vIE9ubHkgdGhlIGxhc3Qgc291cmNlIG1heSBiZSBsZXNzIHRoYW4gYGFic01pblBhcnRTaXplYFxuICAgICAgaWYgKHNyY0NvcHlTaXplIDwgUEFSVF9DT05TVFJBSU5UUy5BQlNfTUlOX1BBUlRfU0laRSAmJiBpbmRleCA8IHNvdXJjZUZpbGVzTGVuZ3RoIC0gMSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgIGBDb3B5U3JjT3B0aW9ucyAke2luZGV4fSBpcyB0b28gc21hbGwgKCR7c3JjQ29weVNpemV9KSBhbmQgaXQgaXMgbm90IHRoZSBsYXN0IHBhcnQuYCxcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICAvLyBJcyBkYXRhIHRvIGNvcHkgdG9vIGxhcmdlP1xuICAgICAgdG90YWxTaXplICs9IHNyY0NvcHlTaXplXG4gICAgICBpZiAodG90YWxTaXplID4gUEFSVF9DT05TVFJBSU5UUy5NQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBDYW5ub3QgY29tcG9zZSBhbiBvYmplY3Qgb2Ygc2l6ZSAke3RvdGFsU2l6ZX0gKD4gNVRpQilgKVxuICAgICAgfVxuXG4gICAgICAvLyByZWNvcmQgc291cmNlIHNpemVcbiAgICAgIHNyY09iamVjdFNpemVzW2luZGV4XSA9IHNyY0NvcHlTaXplXG5cbiAgICAgIC8vIGNhbGN1bGF0ZSBwYXJ0cyBuZWVkZWQgZm9yIGN1cnJlbnQgc291cmNlXG4gICAgICB0b3RhbFBhcnRzICs9IHBhcnRzUmVxdWlyZWQoc3JjQ29weVNpemUpXG4gICAgICAvLyBEbyB3ZSBuZWVkIG1vcmUgcGFydHMgdGhhbiB3ZSBhcmUgYWxsb3dlZD9cbiAgICAgIGlmICh0b3RhbFBhcnRzID4gUEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlQpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICBgWW91ciBwcm9wb3NlZCBjb21wb3NlIG9iamVjdCByZXF1aXJlcyBtb3JlIHRoYW4gJHtQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVH0gcGFydHNgLFxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXNJdGVtU3RhdFxuICAgIH0pXG5cbiAgICBpZiAoKHRvdGFsUGFydHMgPT09IDEgJiYgdG90YWxTaXplIDw9IFBBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRfU0laRSkgfHwgdG90YWxTaXplID09PSAwKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb3B5T2JqZWN0KHNvdXJjZU9iakxpc3RbMF0gYXMgQ29weVNvdXJjZU9wdGlvbnMsIGRlc3RPYmpDb25maWcpIC8vIHVzZSBjb3B5T2JqZWN0VjJcbiAgICB9XG5cbiAgICAvLyBwcmVzZXJ2ZSBldGFnIHRvIGF2b2lkIG1vZGlmaWNhdGlvbiBvZiBvYmplY3Qgd2hpbGUgY29weWluZy5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNvdXJjZUZpbGVzTGVuZ3RoOyBpKyspIHtcbiAgICAgIDsoc291cmNlT2JqTGlzdFtpXSBhcyBDb3B5U291cmNlT3B0aW9ucykuTWF0Y2hFVGFnID0gKHZhbGlkYXRlZFN0YXRzW2ldIGFzIEJ1Y2tldEl0ZW1TdGF0KS5ldGFnXG4gICAgfVxuXG4gICAgY29uc3Qgc3BsaXRQYXJ0U2l6ZUxpc3QgPSB2YWxpZGF0ZWRTdGF0cy5tYXAoKHJlc0l0ZW1TdGF0LCBpZHgpID0+IHtcbiAgICAgIHJldHVybiBjYWxjdWxhdGVFdmVuU3BsaXRzKHNyY09iamVjdFNpemVzW2lkeF0gYXMgbnVtYmVyLCBzb3VyY2VPYmpMaXN0W2lkeF0gYXMgQ29weVNvdXJjZU9wdGlvbnMpXG4gICAgfSlcblxuICAgIGNvbnN0IGdldFVwbG9hZFBhcnRDb25maWdMaXN0ID0gKHVwbG9hZElkOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnN0IHVwbG9hZFBhcnRDb25maWdMaXN0OiBVcGxvYWRQYXJ0Q29uZmlnW10gPSBbXVxuXG4gICAgICBzcGxpdFBhcnRTaXplTGlzdC5mb3JFYWNoKChzcGxpdFNpemUsIHNwbGl0SW5kZXg6IG51bWJlcikgPT4ge1xuICAgICAgICBpZiAoc3BsaXRTaXplKSB7XG4gICAgICAgICAgY29uc3QgeyBzdGFydEluZGV4OiBzdGFydElkeCwgZW5kSW5kZXg6IGVuZElkeCwgb2JqSW5mbzogb2JqQ29uZmlnIH0gPSBzcGxpdFNpemVcblxuICAgICAgICAgIGNvbnN0IHBhcnRJbmRleCA9IHNwbGl0SW5kZXggKyAxIC8vIHBhcnQgaW5kZXggc3RhcnRzIGZyb20gMS5cbiAgICAgICAgICBjb25zdCB0b3RhbFVwbG9hZHMgPSBBcnJheS5mcm9tKHN0YXJ0SWR4KVxuXG4gICAgICAgICAgY29uc3QgaGVhZGVycyA9IChzb3VyY2VPYmpMaXN0W3NwbGl0SW5kZXhdIGFzIENvcHlTb3VyY2VPcHRpb25zKS5nZXRIZWFkZXJzKClcblxuICAgICAgICAgIHRvdGFsVXBsb2Fkcy5mb3JFYWNoKChzcGxpdFN0YXJ0LCB1cGxkQ3RySWR4KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzcGxpdEVuZCA9IGVuZElkeFt1cGxkQ3RySWR4XVxuXG4gICAgICAgICAgICBjb25zdCBzb3VyY2VPYmogPSBgJHtvYmpDb25maWcuQnVja2V0fS8ke29iakNvbmZpZy5PYmplY3R9YFxuICAgICAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UnXSA9IGAke3NvdXJjZU9ian1gXG4gICAgICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1yYW5nZSddID0gYGJ5dGVzPSR7c3BsaXRTdGFydH0tJHtzcGxpdEVuZH1gXG5cbiAgICAgICAgICAgIGNvbnN0IHVwbG9hZFBhcnRDb25maWcgPSB7XG4gICAgICAgICAgICAgIGJ1Y2tldE5hbWU6IGRlc3RPYmpDb25maWcuQnVja2V0LFxuICAgICAgICAgICAgICBvYmplY3ROYW1lOiBkZXN0T2JqQ29uZmlnLk9iamVjdCxcbiAgICAgICAgICAgICAgdXBsb2FkSUQ6IHVwbG9hZElkLFxuICAgICAgICAgICAgICBwYXJ0TnVtYmVyOiBwYXJ0SW5kZXgsXG4gICAgICAgICAgICAgIGhlYWRlcnM6IGhlYWRlcnMsXG4gICAgICAgICAgICAgIHNvdXJjZU9iajogc291cmNlT2JqLFxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB1cGxvYWRQYXJ0Q29uZmlnTGlzdC5wdXNoKHVwbG9hZFBhcnRDb25maWcpXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIHVwbG9hZFBhcnRDb25maWdMaXN0XG4gICAgfVxuXG4gICAgY29uc3QgdXBsb2FkQWxsUGFydHMgPSBhc3luYyAodXBsb2FkTGlzdDogVXBsb2FkUGFydENvbmZpZ1tdKSA9PiB7XG4gICAgICBjb25zdCBwYXJ0VXBsb2FkcyA9IHVwbG9hZExpc3QubWFwKGFzeW5jIChpdGVtKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLnVwbG9hZFBhcnQoaXRlbSlcbiAgICAgIH0pXG4gICAgICAvLyBQcm9jZXNzIHJlc3VsdHMgaGVyZSBpZiBuZWVkZWRcbiAgICAgIHJldHVybiBhd2FpdCBQcm9taXNlLmFsbChwYXJ0VXBsb2FkcylcbiAgICB9XG5cbiAgICBjb25zdCBwZXJmb3JtVXBsb2FkUGFydHMgPSBhc3luYyAodXBsb2FkSWQ6IHN0cmluZykgPT4ge1xuICAgICAgY29uc3QgdXBsb2FkTGlzdCA9IGdldFVwbG9hZFBhcnRDb25maWdMaXN0KHVwbG9hZElkKVxuICAgICAgY29uc3QgcGFydHNSZXMgPSBhd2FpdCB1cGxvYWRBbGxQYXJ0cyh1cGxvYWRMaXN0KVxuICAgICAgcmV0dXJuIHBhcnRzUmVzLm1hcCgocGFydENvcHkpID0+ICh7IGV0YWc6IHBhcnRDb3B5LmV0YWcsIHBhcnQ6IHBhcnRDb3B5LnBhcnQgfSkpXG4gICAgfVxuXG4gICAgY29uc3QgbmV3VXBsb2FkSGVhZGVycyA9IGRlc3RPYmpDb25maWcuZ2V0SGVhZGVycygpXG5cbiAgICBjb25zdCB1cGxvYWRJZCA9IGF3YWl0IHRoaXMuaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoZGVzdE9iakNvbmZpZy5CdWNrZXQsIGRlc3RPYmpDb25maWcuT2JqZWN0LCBuZXdVcGxvYWRIZWFkZXJzKVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJ0c0RvbmUgPSBhd2FpdCBwZXJmb3JtVXBsb2FkUGFydHModXBsb2FkSWQpXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb21wbGV0ZU11bHRpcGFydFVwbG9hZChkZXN0T2JqQ29uZmlnLkJ1Y2tldCwgZGVzdE9iakNvbmZpZy5PYmplY3QsIHVwbG9hZElkLCBwYXJ0c0RvbmUpXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5hYm9ydE11bHRpcGFydFVwbG9hZChkZXN0T2JqQ29uZmlnLkJ1Y2tldCwgZGVzdE9iakNvbmZpZy5PYmplY3QsIHVwbG9hZElkKVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHByZXNpZ25lZFVybChcbiAgICBtZXRob2Q6IHN0cmluZyxcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGV4cGlyZXM/OiBudW1iZXIgfCBQcmVTaWduUmVxdWVzdFBhcmFtcyB8IHVuZGVmaW5lZCxcbiAgICByZXFQYXJhbXM/OiBQcmVTaWduUmVxdWVzdFBhcmFtcyB8IERhdGUsXG4gICAgcmVxdWVzdERhdGU/OiBEYXRlLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICh0aGlzLmFub255bW91cykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5Bbm9ueW1vdXNSZXF1ZXN0RXJyb3IoYFByZXNpZ25lZCAke21ldGhvZH0gdXJsIGNhbm5vdCBiZSBnZW5lcmF0ZWQgZm9yIGFub255bW91cyByZXF1ZXN0c2ApXG4gICAgfVxuXG4gICAgaWYgKCFleHBpcmVzKSB7XG4gICAgICBleHBpcmVzID0gUFJFU0lHTl9FWFBJUllfREFZU19NQVhcbiAgICB9XG4gICAgaWYgKCFyZXFQYXJhbXMpIHtcbiAgICAgIHJlcVBhcmFtcyA9IHt9XG4gICAgfVxuICAgIGlmICghcmVxdWVzdERhdGUpIHtcbiAgICAgIHJlcXVlc3REYXRlID0gbmV3IERhdGUoKVxuICAgIH1cblxuICAgIC8vIFR5cGUgYXNzZXJ0aW9uc1xuICAgIGlmIChleHBpcmVzICYmIHR5cGVvZiBleHBpcmVzICE9PSAnbnVtYmVyJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZXhwaXJlcyBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKHJlcVBhcmFtcyAmJiB0eXBlb2YgcmVxUGFyYW1zICE9PSAnb2JqZWN0Jykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxUGFyYW1zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoKHJlcXVlc3REYXRlICYmICEocmVxdWVzdERhdGUgaW5zdGFuY2VvZiBEYXRlKSkgfHwgKHJlcXVlc3REYXRlICYmIGlzTmFOKHJlcXVlc3REYXRlPy5nZXRUaW1lKCkpKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxdWVzdERhdGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJEYXRlXCIgYW5kIHZhbGlkJylcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyeSA9IHJlcVBhcmFtcyA/IHFzLnN0cmluZ2lmeShyZXFQYXJhbXMpIDogdW5kZWZpbmVkXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVnaW9uID0gYXdhaXQgdGhpcy5nZXRCdWNrZXRSZWdpb25Bc3luYyhidWNrZXROYW1lKVxuICAgICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXG4gICAgICBjb25zdCByZXFPcHRpb25zID0gdGhpcy5nZXRSZXF1ZXN0T3B0aW9ucyh7IG1ldGhvZCwgcmVnaW9uLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxuXG4gICAgICByZXR1cm4gcHJlc2lnblNpZ25hdHVyZVY0KFxuICAgICAgICByZXFPcHRpb25zLFxuICAgICAgICB0aGlzLmFjY2Vzc0tleSxcbiAgICAgICAgdGhpcy5zZWNyZXRLZXksXG4gICAgICAgIHRoaXMuc2Vzc2lvblRva2VuLFxuICAgICAgICByZWdpb24sXG4gICAgICAgIHJlcXVlc3REYXRlLFxuICAgICAgICBleHBpcmVzLFxuICAgICAgKVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgVW5hYmxlIHRvIGdldCBidWNrZXQgcmVnaW9uIGZvciAgJHtidWNrZXROYW1lfS5gKVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHByZXNpZ25lZEdldE9iamVjdChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGV4cGlyZXM/OiBudW1iZXIsXG4gICAgcmVzcEhlYWRlcnM/OiBQcmVTaWduUmVxdWVzdFBhcmFtcyB8IERhdGUsXG4gICAgcmVxdWVzdERhdGU/OiBEYXRlLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgdmFsaWRSZXNwSGVhZGVycyA9IFtcbiAgICAgICdyZXNwb25zZS1jb250ZW50LXR5cGUnLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtbGFuZ3VhZ2UnLFxuICAgICAgJ3Jlc3BvbnNlLWV4cGlyZXMnLFxuICAgICAgJ3Jlc3BvbnNlLWNhY2hlLWNvbnRyb2wnLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtZGlzcG9zaXRpb24nLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtZW5jb2RpbmcnLFxuICAgIF1cbiAgICB2YWxpZFJlc3BIZWFkZXJzLmZvckVhY2goKGhlYWRlcikgPT4ge1xuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgaWYgKHJlc3BIZWFkZXJzICE9PSB1bmRlZmluZWQgJiYgcmVzcEhlYWRlcnNbaGVhZGVyXSAhPT0gdW5kZWZpbmVkICYmICFpc1N0cmluZyhyZXNwSGVhZGVyc1toZWFkZXJdKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGByZXNwb25zZSBoZWFkZXIgJHtoZWFkZXJ9IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCJgKVxuICAgICAgfVxuICAgIH0pXG4gICAgcmV0dXJuIHRoaXMucHJlc2lnbmVkVXJsKCdHRVQnLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBleHBpcmVzLCByZXNwSGVhZGVycywgcmVxdWVzdERhdGUpXG4gIH1cblxuICBhc3luYyBwcmVzaWduZWRQdXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGV4cGlyZXM/OiBudW1iZXIpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucHJlc2lnbmVkVXJsKCdQVVQnLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBleHBpcmVzKVxuICB9XG5cbiAgbmV3UG9zdFBvbGljeSgpOiBQb3N0UG9saWN5IHtcbiAgICByZXR1cm4gbmV3IFBvc3RQb2xpY3koKVxuICB9XG5cbiAgYXN5bmMgcHJlc2lnbmVkUG9zdFBvbGljeShwb3N0UG9saWN5OiBQb3N0UG9saWN5KTogUHJvbWlzZTxQb3N0UG9saWN5UmVzdWx0PiB7XG4gICAgaWYgKHRoaXMuYW5vbnltb3VzKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkFub255bW91c1JlcXVlc3RFcnJvcignUHJlc2lnbmVkIFBPU1QgcG9saWN5IGNhbm5vdCBiZSBnZW5lcmF0ZWQgZm9yIGFub255bW91cyByZXF1ZXN0cycpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QocG9zdFBvbGljeSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3Bvc3RQb2xpY3kgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwb3N0UG9saWN5LmZvcm1EYXRhLmJ1Y2tldCBhcyBzdHJpbmdcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVnaW9uID0gYXdhaXQgdGhpcy5nZXRCdWNrZXRSZWdpb25Bc3luYyhidWNrZXROYW1lKVxuXG4gICAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoKVxuICAgICAgY29uc3QgZGF0ZVN0ciA9IG1ha2VEYXRlTG9uZyhkYXRlKVxuICAgICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXG5cbiAgICAgIGlmICghcG9zdFBvbGljeS5wb2xpY3kuZXhwaXJhdGlvbikge1xuICAgICAgICAvLyAnZXhwaXJhdGlvbicgaXMgbWFuZGF0b3J5IGZpZWxkIGZvciBTMy5cbiAgICAgICAgLy8gU2V0IGRlZmF1bHQgZXhwaXJhdGlvbiBkYXRlIG9mIDcgZGF5cy5cbiAgICAgICAgY29uc3QgZXhwaXJlcyA9IG5ldyBEYXRlKClcbiAgICAgICAgZXhwaXJlcy5zZXRTZWNvbmRzKFBSRVNJR05fRVhQSVJZX0RBWVNfTUFYKVxuICAgICAgICBwb3N0UG9saWN5LnNldEV4cGlyZXMoZXhwaXJlcylcbiAgICAgIH1cblxuICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LWRhdGUnLCBkYXRlU3RyXSlcbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LWRhdGUnXSA9IGRhdGVTdHJcblxuICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LWFsZ29yaXRobScsICdBV1M0LUhNQUMtU0hBMjU2J10pXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1hbGdvcml0aG0nXSA9ICdBV1M0LUhNQUMtU0hBMjU2J1xuXG4gICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotY3JlZGVudGlhbCcsIHRoaXMuYWNjZXNzS2V5ICsgJy8nICsgZ2V0U2NvcGUocmVnaW9uLCBkYXRlKV0pXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1jcmVkZW50aWFsJ10gPSB0aGlzLmFjY2Vzc0tleSArICcvJyArIGdldFNjb3BlKHJlZ2lvbiwgZGF0ZSlcblxuICAgICAgaWYgKHRoaXMuc2Vzc2lvblRva2VuKSB7XG4gICAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1zZWN1cml0eS10b2tlbicsIHRoaXMuc2Vzc2lvblRva2VuXSlcbiAgICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotc2VjdXJpdHktdG9rZW4nXSA9IHRoaXMuc2Vzc2lvblRva2VuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBvbGljeUJhc2U2NCA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHBvc3RQb2xpY3kucG9saWN5KSkudG9TdHJpbmcoJ2Jhc2U2NCcpXG5cbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGEucG9saWN5ID0gcG9saWN5QmFzZTY0XG5cbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LXNpZ25hdHVyZSddID0gcG9zdFByZXNpZ25TaWduYXR1cmVWNChyZWdpb24sIGRhdGUsIHRoaXMuc2VjcmV0S2V5LCBwb2xpY3lCYXNlNjQpXG4gICAgICBjb25zdCBvcHRzID0ge1xuICAgICAgICByZWdpb246IHJlZ2lvbixcbiAgICAgICAgYnVja2V0TmFtZTogYnVja2V0TmFtZSxcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICB9XG4gICAgICBjb25zdCByZXFPcHRpb25zID0gdGhpcy5nZXRSZXF1ZXN0T3B0aW9ucyhvcHRzKVxuICAgICAgY29uc3QgcG9ydFN0ciA9IHRoaXMucG9ydCA9PSA4MCB8fCB0aGlzLnBvcnQgPT09IDQ0MyA/ICcnIDogYDoke3RoaXMucG9ydC50b1N0cmluZygpfWBcbiAgICAgIGNvbnN0IHVybFN0ciA9IGAke3JlcU9wdGlvbnMucHJvdG9jb2x9Ly8ke3JlcU9wdGlvbnMuaG9zdH0ke3BvcnRTdHJ9JHtyZXFPcHRpb25zLnBhdGh9YFxuICAgICAgcmV0dXJuIHsgcG9zdFVSTDogdXJsU3RyLCBmb3JtRGF0YTogcG9zdFBvbGljeS5mb3JtRGF0YSB9XG4gICAgfSBjYXRjaCAoZXIpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYFVuYWJsZSB0byBnZXQgYnVja2V0IHJlZ2lvbiBmb3IgICR7YnVja2V0TmFtZX0uYClcbiAgICB9XG4gIH1cbn1c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