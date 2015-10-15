/**
 * Error class for Clover specific errors.
 *
 * @param {string} code a code to classify the error.
 * @param {string} message the error message
 * @param {Error} cause the original cause of the error if this wraps some lower level system error.
 * @constructor
 */
function CloverError(code, message, cause) {
    this.name = "CloverError";
    this.code = code;
    this.message = message;
    this.cause = cause;

    this.stack = (new Error()).stack;
}
CloverError.prototype = new Error;
/** INVALID_DATA */
CloverError.INVALID_DATA = "invalid data";
/** NOT_IMPLEMENTED */
CloverError.NOT_IMPLEMENTED = "not implemented";
/** DEVICE_OFFLINE */
CloverError.DEVICE_OFFLINE = "device offline";
/** INCOMPLETE_CONFIGURATION */
CloverError.INCOMPLETE_CONFIGURATION = "incomplete configuration";
/** DISCOVERY_TIMEOUT */
CloverError.DISCOVERY_TIMEOUT = "discovery timeout";
/** COMMUNICATION_ERROR */
CloverError.COMMUNICATION_ERROR = "communication error";
/** INVALID_DATA */
CloverError.DEVICE_NOT_FOUND = "device not found";
