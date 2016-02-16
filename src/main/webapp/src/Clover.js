/**
 * Clover API for external Systems
 *
 * @param {CloverConfig} [configuration] - the device that sends and receives messages
 * @constructor
 */
function Clover(configuration) {
    this.configuration = configuration;
    if (!this.configuration) {
        this.configuration = {};
    }
    this.configuration.allowOvertakeConnection =
        Boolean(this.configuration["allowOvertakeConnection"]);

    this.device = new WebSocketDevice(this.configuration.allowOvertakeConnection, this.configuration["friendlyId"]);
    this.device.messageBuilder = new RemoteMessageBuilder("com.clover.remote.protocol.lan");
    // Echo all messages sent and received.
    this.device.echoAllMessages = false;
    this.pauseBetweenDiscovery = 3000;
    this.numberOfDiscoveryMessagesToSend = 10;
    // This is used to augment the 'isOpen' functionality.
    this.discoveryResponseReceived = false;

    /*
     Set up a value to help the user of the Clover object know when it is available.
     */
    this._isOpen = false;
    this.device.on(WebSocketDevice.DEVICE_OPEN, function () {
        this._isOpen = true;
    }.bind(this));
    this.device.on(WebSocketDevice.DEVICE_CLOSE, function () {
        this._isOpen = false;
        this.configuration.deviceURL = null;
        this.discoveryResponseReceived = false;
    }.bind(this));
    this.device.on(WebSocketDevice.DEVICE_ERROR, function () {
        this._isOpen = false;
        this.device.forceClose();
    }.bind(this));
    this.device.on(WebSocketDevice.CONNECTION_ERROR, function () {
        this._isOpen = false;
        this.device.forceClose();
    }.bind(this));
    this.device.on(WebSocketDevice.CONNECTION_STOLEN, function () {
        this._isOpen = false;
        this.device.forceClose();
    }.bind(this));

    /**
     * @returns {boolean} true if the device is open and ready for communications,
     *  false if the device is closed, or has an error.
     */
    this.isOpen = function () {
        // The device must not only be opened, it must have responded with a discovery response
        // to indicate that not only is the socket communication channel open, but the device
        // has bootstrapped the functionality to actually respond to messages.
        return this._isOpen && this.discoveryResponseReceived;
    }

    /*
     The following is a bit elaborate, but I want it to be clear that the default of
     this value is 'true', and that it is only false if explicitly set.
     */
    if (this.configuration.hasOwnProperty("autoVerifySignature") &&
        this.configuration.autoVerifySignature != null &&
        this.configuration.autoVerifySignature === false) {
        this.configuration.autoVerifySignature = false;
    } else {
        this.configuration.autoVerifySignature = true;
    }

    this.configuration.disableRestartTransactionWhenFailed =
        Boolean(this.configuration.disableRestartTransactionWhenFailed);

    this.configuration.remotePrint =
        Boolean(this.configuration.remotePrint);

    /**
     * @private
     * @returns {{action: string, transactionType: string, transactionSubType: string, taxAmount: number, cardEntryMethods: *, disableRestartTransactionWhenFailed: boolean, remotePrint: boolean}}
     */
    this.sale_payIntentTemplate = function () {
        return {
            "action": "com.clover.remote.protocol.action.START_REMOTE_PROTOCOL_PAY",
            "transactionType": "PAYMENT",
            "taxAmount": 0, // tax amount is included in the amount
            "cardEntryMethods": CardEntryMethods.ALL,
            "disableRestartTransactionWhenFailed": this.configuration.disableRestartTransactionWhenFailed,
            "remotePrint": this.configuration.remotePrint
        };
    };

    /**
     * @private
     * @returns {{action: string, transactionType: string, transactionSubType: string, taxAmount: number, cardEntryMethods: *, disableRestartTransactionWhenFailed: boolean, remotePrint: boolean}}
     */
    this.auth_payIntentTemplate = function () {
        return {
            "action": "com.clover.remote.protocol.action.START_REMOTE_PROTOCOL_PAY",
            "transactionType": "PAYMENT",
            "taxAmount": 0, // tax amount is included in the amount
            "cardEntryMethods": CardEntryMethods.ALL,
            "disableRestartTransactionWhenFailed": this.configuration.disableRestartTransactionWhenFailed,
            "remotePrint": this.configuration.remotePrint
        };
    };

    /**
     * @private
     * @returns {{action: string, transactionType: string, taxAmount: number, cardEntryMethods: *, disableRestartTransactionWhenFailed: boolean, remotePrint: boolean}}
     */
    this.preAuth_payIntentTemplate = function () {
        return {
            "action": "com.clover.remote.protocol.action.START_REMOTE_PROTOCOL_PAY",
            "transactionType": "AUTH",
            "taxAmount": 0, // tax amount is included in the amount
            "cardEntryMethods": CardEntryMethods.ALL,
            "disableRestartTransactionWhenFailed": this.configuration.disableRestartTransactionWhenFailed,
            "remotePrint": this.configuration.remotePrint
        };
    };

    /**
     * @private
     * @type {{action: string, transactionType: string, taxAmount: number, cardEntryMethods: *, disableRestartTransactionWhenFailed: boolean, remotePrint: boolean}}
     */
    this.refund_payIntentTemplate = {
        "action": "com.clover.remote.protocol.action.START_REMOTE_PROTOCOL_PAY",
        "transactionType": "CREDIT",
        "taxAmount": 0, // tax amount is included in the amount
        "cardEntryMethods": CardEntryMethods.ALL,
        "disableRestartTransactionWhenFailed": this.configuration.disableRestartTransactionWhenFailed,
        "remotePrint": this.configuration.remotePrint
    };

    //****************************************
    // Very useful for debugging
    //****************************************
    this.device.on(WebSocketDevice.ALL_MESSAGES,
        function (message) {
            if ((message['type'] != 'PONG') && (message['type'] != 'PING')) {
                console.log(message);
            }
        }
    );

    /**
     * Returns true if the signature should be automatically verified
     * @private
     * @returns {boolean}
     */
    this.getAutoVerifySignature = function () {
        if (this.configuration.hasOwnProperty("autoVerifySignature") &&
            this.configuration.autoVerifySignature != null &&
            this.configuration.autoVerifySignature === false) {
            return false;
        }
        return true;
    }

    /**
     * Closes the connection to the Clover device.
     */
    this.close = function () {
        if (this.device) {
            if (this.device.discoveryTimerId) {
                clearInterval(this.device.discoveryTimerId);
            }
            this.sendCancel();
            this.device.disconnectFromDevice();
        }
    }


    /**
     * Called to initialize the device for communications.
     *
     *  The device connection is NOT made on completion of this call.  The device connection
     *  will be made once the WebSocketDevice.onopen is called.
     *
     *  If there is no active configuration, then this will try to load the configuration using
     *  Clover.loadPersistedConfiguration.  Once the deviceURL has been derived, an attempt will be made to persist
     *  the configuration using Clover.persistConfiguration.
     *
     *  If there is not enough configuration information to connect to the device, then Clover.incompleteConfiguration
     *  will be called.
     *
     *  If the device is not connected to the push server, the callback will be called with the first parameter of a
     *  CloverError with a code of CloverError.DEVICE_OFFLINE.
     *
     *  If there is a communication error retrieving the device websocket connection point or device info, the callback
     *  will be called with the first parameter of a CloverError with a code of CloverError.COMMUNICATION_ERROR.
     *
     *  If the configuration of the device is incomplete, the callback will be called with the first parameter of a
     *  CloverError with a code of CloverError.INCOMPLETE_CONFIGURATION.
     *
     *  If the device is contacted, but does not respond to a discovery request, the callback will be called with the first parameter of a
     *  CloverError with a code of CloverError.DISCOVERY_TIMEOUT.
     *
     * @param callBackOnDeviceReady - callback function called when the device is ready for operations.  The
     *  callback function can be called with several possible results.
     *
     *  Adheres to error first paradigm.
     */
    this.initDeviceConnection = function (callBackOnDeviceReady) {
        if (!this.isOpen()) {
            if (callBackOnDeviceReady) {
                this.device.once(LanMethod.DISCOVERY_RESPONSE, function (message) {
                    callBackOnDeviceReady(null, message)
                });
            }
            return this.initDeviceConnectionInternal(callBackOnDeviceReady);
        }
        else {
            callBackOnDeviceReady();
        }
    }

    /**
     * Called to initialize the device for communications.
     *
     *  The device connection is NOT made on completion of this call.  The device connection
     *  will be made once the WebSocketDevice.onopen is called.
     * @private
     * @param callBackOnDeviceReady - callback function called when the device is ready for operations.
     */
    this.initDeviceConnectionInternal = function (callBackOnDeviceReady) {
        // Check to see if we have any configuration at all.
        if (!this.configuration) {
            if (!this.loadPersistedConfiguration(callBackOnDeviceReady)) {
                return;
            }
            this.initDeviceConnectionInternal(callBackOnDeviceReady);
        } else if (this.configuration.deviceURL) {
            // We have enough information to contact the device.
            // save the configuration (except for the device url, which always changes)
            // in a cookie.
            this.persistConfiguration();

            // We have the device url, contact the device
            this.contactDevice(callBackOnDeviceReady);
        } else {
            // Otherwise we must have the oauth token to get the information we need at the very least.
            // Either we already have it...
            if (this.configuration.oauthToken) {
                // We need the access token, the domain and the merchantId in order to get the devices
                // We already know that we have the token, but we need to check for the
                // domain and merchantId.
                if (this.configuration.domain && this.configuration.merchantId) {
                    // We need the device id of the device we will contact.
                    // Either we have it...
                    var xmlHttpSupport = new XmlHttpSupport();
                    var inlineEndpointConfig = {"configuration": {}};
                    var me = this;
                    inlineEndpointConfig.getAccessToken = function () {
                        return me.configuration.oauthToken;
                    };
                    inlineEndpointConfig.configuration.domain = this.configuration.domain;
                    var endpoints = new Endpoints(inlineEndpointConfig);

                    if (this.configuration.deviceId) {
                        var noDashesDeviceId = this.configuration.deviceId.replace(/-/g, "");
                        // this is the uuid for the device
                        xmlHttpSupport = new XmlHttpSupport();
                        // This is the data posted to tell the server we want to create a connection
                        // to the device
                        var deviceContactInfo = {
                            deviceId: noDashesDeviceId,
                            isSilent: true
                        };

                        xmlHttpSupport.postData(endpoints.getAlertDeviceEndpoint(this.configuration.merchantId),
                            function (data) {

                                me.device.bootStrapReconnect = function(callback) {
                                    xmlHttpSupport.postData(endpoints.getAlertDeviceEndpoint(me.configuration.merchantId),
                                        callback, callback, deviceContactInfo);
                                }
                                // The format of the data received is:
                                //{
                                //    'sent': true | false,
                                //    'host': web_socket_host,
                                //    'token': token_to_link_to_the_device
                                //}
                                // Use this data to build the web socket url
                                // Note "!data.hasOwnProperty('sent')" is included to allow for
                                // backwards compatibility.  If the property is NOT included, then
                                // we will assume an earlier version of the protocol on the server,
                                // and assume that the notification WAS SENT.
                                if (!data.hasOwnProperty('sent') || data.sent) {
                                    var url = data.host + Endpoints.WEBSOCKET_PATH + '?token=' + data.token;
                                    me.device.messageBuilder = new RemoteMessageBuilder(
                                        "com.clover.remote.protocol.websocket");

                                    console.log("Server responded with information on how to contact device. " +
                                        "Opening communication channel...");

                                    // The response to this will be reflected in the device.onopen method (or on error),
                                    // That function will attempt the discovery.
                                    me.configuration.deviceURL = url;
                                    //recurse
                                    me.initDeviceConnectionInternal(callBackOnDeviceReady);
                                } else {
                                    // Should it retry?
                                    // If the callback is defined, call it.
                                    var message = "Device is not connected to push server, cannot create connection";
                                    if (callBackOnDeviceReady) {
                                        callBackOnDeviceReady(new CloverError(CloverError.DEVICE_OFFLINE,
                                            message));
                                    } else {
                                        console.log(message);
                                    }
                                }
                            },
                            function (error) {
                                if (callBackOnDeviceReady) {
                                    callBackOnDeviceReady(new CloverError(CloverError.COMMUNICATION_ERROR,
                                        "Error getting device ws endpoint", error));
                                } else {
                                    console.log(error);
                                }
                            }, deviceContactInfo
                        );

                    } else if (this.configuration.deviceSerialId) {
                        // or we need to go get it.  This is a little hard, because the merchant
                        // can have multiple devices.

                        // If there are multiple devices, we need to know which device the user wants
                        // to use.  They can pass the 'serial' number of the device, or a 0 - based index
                        // for the devices, which assumes they know what order the device list will be
                        // returned in.
                        var url = endpoints.getDevicesEndpoint(this.configuration.merchantId);

                        xmlHttpSupport.getData(url,
                            function (devices) {
                                me.handleDevices(devices);
                                // Stations do not support the kiosk/pay display.
                                // If the user has selected one, then print out a (loud) warning
                                var myDevice = me.deviceBySerial[me.configuration.deviceSerialId];
                                if (null == myDevice) {
                                    callBackOnDeviceReady(new CloverError(CloverError.DEVICE_NOT_FOUND,
                                        "Device " + deviceSerialId + " not in set returned."));
                                }
                                if (me.deviceBySerial[me.configuration.deviceSerialId].model == "Clover_C100") {
                                    console.log(
                                        "Warning - Selected device model (" +
                                        me.deviceBySerial[me.configuration.deviceSerialId].model +
                                        ") does not support cloud pay display." +
                                        "  Will attempt to send notification to device, but no response" +
                                        " should be expected.");
                                }
                                // serial' number of the device
                                me.configuration.deviceId =
                                    me.deviceBySerial[me.configuration.deviceSerialId].id;
                                // recurse
                                me.initDeviceConnectionInternal(callBackOnDeviceReady);
                            }
                            , function (error) {
                                if (callBackOnDeviceReady) {
                                    callBackOnDeviceReady(new CloverError(CloverError.COMMUNICATION_ERROR,
                                        "Error getting device information", error));
                                } else {
                                    console.log(error);
                                }
                            }
                        );
                    } else {
                        //Nothing left to try.  Either error out or get more info from the user.
                        this.incompleteConfiguration("Cannot determine what device to use for connection." +
                            "  You must provide the configuration.deviceId, or the serial number" +
                            " of the device. " +
                            " You can find the device serial number using the device. Select " +
                            "'Settings > About (Station|Mini|Mobile) > Status', select 'Status' and " +
                            "look for 'Serial number' in the list displayed.", this.configuration,
                            callBackOnDeviceReady);
                        return;

                    }
                } else {
                    // We do not have enough info to initialize.  Error out
                    this.incompleteConfiguration("Incomplete init info.", this.configuration,
                        callBackOnDeviceReady);
                    return;
                }
            } else {
                // or we need to go get it.
                // If we need to go get it, then we will need the clientId
                // and the domain
                if (this.configuration.clientId && this.configuration.domain) {
                    this.cloverOAuth = new CloverOAuth(this.configuration);
                    // This may cause a redirect
                    this.configuration.oauthToken = this.cloverOAuth.getAccessToken();
                    // recurse
                    this.initDeviceConnectionInternal(callBackOnDeviceReady);
                } else {
                    if (!this.loadPersistedConfiguration(callBackOnDeviceReady)) {
                        return;
                    }
                    this.initDeviceConnectionInternal(callBackOnDeviceReady);
                }
            }
        }
    }

    /**
     * Loads the configuration that was stored.  This implementation just grabs the
     * configuration from a cookie.  Reimplementation of this function could provide
     * configuration from a server or even a UI.
     *
     * @param callback - the error first callback that will be passed to Clover.incompleteConfiguration
     *  if no configuration could be loaded.
     * @returns {boolean} true if the configuration was loaded.
     */
    this.loadPersistedConfiguration = function (callback) {
        // We have no configuration at all.  Try to get it from a cookie
        if (!this.configurationName)this.configurationName = "CLOVER_DEFAULT";
        this.configuration = Clover.loadConfigurationFromCookie(this.configurationName);
        if (!this.configuration) {
            // fire up a gui to get the values?
            // This could be some server call back or other too.
            this.incompleteConfiguration("No initialization info found in cookie", this.configuration, callback);
            return false;
        }
        return true;
    }

    /**
     * Stores the configuration for later retrieval.  This implementation just drops the
     * configuration into a cookie.  Reimplementation of this function could provide
     * server or some other type of cloud persistence.
     */
    this.persistConfiguration = function () {
        Clover.writeConfigurationToCookie(this.configuration);
    }


    /**
     * This can be overridden to provide any missing configuration information to this.configuration (
     * through a UI or a call to the server, etc...), after which a call to
     * Clover.initDeviceConnection would need to be made to continue attempting to connect to the device.
     *
     * Note that if an overridden implementation does NOT properly provide configuration, and a call is made to
     * Clover.initDeviceConnection, there is the possibility of creating a recursive loop that would
     * impact the performance of the application, and could make the browser unstable.
     *
     * Any override of this function should ensure that configuration information is complete before making
     * the call to Clover.initDeviceConnection.
     *
     * @param {string} message - an error message.  This could be ignored.
     * @param {CloverConfig} [configuration] - the configuration that is incomplete.
     * @param callback - the error first callback.  If defined, then it will be called with
     *  the first parameter as a CloverError.  If not defined, then the CloverError will be thrown.
     */
    this.incompleteConfiguration = function (message, configuration, callback) {
        // If this is used to obtain the configuration information, then the
        // configuration should be updated, and then the 'initDeviceConnection'
        // should be called again to connect to the device.
        var error = new CloverError(CloverError.INCOMPLETE_CONFIGURATION, message);
        if (callback) {
            callback(error);
        } else {
            throw error;
        }
    }

    /**
     * Handle a set of devices.  Sets up an internal map of devices from serial->device
     * @private
     * @param devicesVX
     */
    this.handleDevices = function (devicesVX) {
        var devices = null;
        this.deviceBySerial = {};
        // depending on the version of the call, the devices might be in a slightly different format.
        // We would need to determine what devices were capable of doing what we want.  This means we
        // need to know if the device has the websocket connection enabled.  The best way to do this is
        // to make a different REST call, but we could filter the devices here.
        if (devicesVX.hasOwnProperty('devices')) {
            devices = devicesVX.devices;
        }
        else if (devicesVX.hasOwnProperty('elements')) {
            devices = devicesVX.elements;
        }
        var i;
        for (i = 0; i < devices.length; i++) {
            this.deviceBySerial[devices[i].serial] = devices[i];
        }
    }

    /**
     * Contacts the device.  Sends DISCOVERY_REQUEST messages for a period of time until a response is received.
     * Currently set to retry 10 times at 3 second intervals
     *
     * @private
     */
    this.contactDevice = function (callBackOnDeviceReady) {
        var me = this;
        this.discoveryResponseReceived = false;

        // Holds all the callbacks so that they can be removed later, if
        // They need to be.  Callbacks need to be removed in the 'end states'
        // that do not visit ALL the callback.
        var allCallBacks = [];

        var discoveryResponseCallback = function (message) {
            // Remove obsolete listeners.  This is an end state
            me.device.removeListeners(allCallBacks);
            // This id is set when the discovery request is sent when the device 'onopen' is called.
            clearInterval(me.device.discoveryTimerId);
            me.device.discoveryTimerId = null;
            me.discoveryResponseReceived = true;
            console.log("Device has responded to discovery message.");
        }
        this.device.once(LanMethod.DISCOVERY_RESPONSE, discoveryResponseCallback);
        allCallBacks.push({"event": LanMethod.DISCOVERY_RESPONSE, "callback": discoveryResponseCallback});

        var onopenCallback = function () {
            // The connection to the device is open, but we do not yet know if there is anyone at the other end.
            // Send discovery request messages until we get a discovery response.
            me.device.dicoveryMessagesSent = 0;
            if (!me.device.discoveryTimerId) {
                me.device.discoveryTimerId =
                    setInterval(
                        function () {
                            console.log("Sending 'discovery' message to device.");
                            try {
                                me.device.sendMessage(me.device.messageBuilder.buildDiscoveryRequest());
                            } catch (e) {
                                console.log(e);
                            }
                            me.device.dicoveryMessagesSent++;

                            // Arbitrary decision that 10 messages is long enough to wait.
                            if (me.device.dicoveryMessagesSent > me.numberOfDiscoveryMessagesToSend) {
                                // Remove obsolete listeners.  This is an end state
                                me.device.removeListeners(allCallBacks);
                                var seconds = (me.numberOfDiscoveryMessagesToSend * me.pauseBetweenDiscovery) / 1000;
                                var message = "No discovery response after " + seconds + " seconds";
                                console.log(message +
                                    "  Shutting down the connection.");
                                me.device.disconnectFromDevice();
                                clearInterval(me.device.discoveryTimerId);
                                me.device.discoveryTimerId = null;
                                if (callBackOnDeviceReady) {
                                    callBackOnDeviceReady(new CloverError(CloverError.DISCOVERY_TIMEOUT,
                                        "No discovery response after 30 seconds"));
                                }
                            }
                        }, me.pauseBetweenDiscovery
                    );
            }
            console.log('device opened');
        }
        this.device.once(WebSocketDevice.DEVICE_OPEN, onopenCallback);
        allCallBacks.push({"event": WebSocketDevice.DEVICE_OPEN, "callback": onopenCallback});

        var connctionDeniedCallback = function (message) {
            // Remove obsolete listeners.  This is an end state
            me.device.removeListeners(allCallBacks);
        }
        this.device.once(WebSocketDevice.CONNECTION_DENIED, connctionDeniedCallback);
        allCallBacks.push({"event": WebSocketDevice.CONNECTION_DENIED, "callback": connctionDeniedCallback});

        console.log("Contacting device at " + this.configuration.deviceURL);
        this.device.contactDevice(this.configuration.deviceURL);
    }

    /**
     * Utility function to ensure that the external payment id is set.
     *
     * @private
     * @param txInfo
     * @returns {*}
     */
    this.ensureExternalPaymentId = function (txInfo) {
        var externalPaymentId = null;
        if (txInfo.hasOwnProperty('requestId') && txInfo.requestId != null) {
            externalPaymentId = txInfo.requestId;
        } else {
            externalPaymentId = CloverID.getNewId();
        }
        txInfo.externalPaymentId = externalPaymentId;
        return txInfo;
    }

    /**
     * Sale AKA purchase
     *
     * @param {TransactionRequest} saleInfo - the information for the sale
     * @param {Clover~transactionRequestCallback} saleRequestCallback - the callback that receives the sale completion
     *  information.
     * @return {string} paymentId - identifier used for the payment once the transaction is completed.  This may be
     *  passed in as part of the saleInfo.  If it is not passed in then this will be a new generated value.
     */
    this.sale = function (saleInfo, saleRequestCallback) {
        this.ensureExternalPaymentId(saleInfo);
        // For a sale, force the tip to be set
        if (!saleInfo.hasOwnProperty("tipAmount")) {
            saleInfo["tipAmount"] = 0;
        }
        if (this.verifyValidAmount(saleInfo, saleRequestCallback)) {
            this.internalTx(saleInfo, saleRequestCallback, this.sale_payIntentTemplate(), "payment");
        }
        return saleInfo.externalPaymentId;
    }

    /**
     * Auth
     *
     * @param {TransactionRequest} saleInfo - the information for the sale
     * @param {Clover~transactionRequestCallback} saleRequestCallback - the callback that receives the sale completion
     *  information.
     * @return {string} paymentId - identifier used for the payment once the transaction is completed.  This may be
     *  passed in as part of the saleInfo.  If it is not passed in then this will be a new generated value.
     */
    this.auth = function (saleInfo, saleRequestCallback) {
        this.ensureExternalPaymentId(saleInfo);
        // For a auth, force the tip to be set to null
        if (saleInfo.hasOwnProperty("tipAmount")) {
            delete saleInfo.tipAmount;
        }
        if (this.verifyValidAmount(saleInfo, saleRequestCallback)) {
            this.internalTx(saleInfo, saleRequestCallback, this.auth_payIntentTemplate(), "payment", true);
        }
        return saleInfo.externalPaymentId;
    }

    /**
     * Pre Auth
     *
     * @param {TransactionRequest} saleInfo - the information for the sale
     * @param {Clover~transactionRequestCallback} saleRequestCallback - the callback that receives the sale completion
     *  information.
     * @return {string} paymentId - identifier used for the payment once the transaction is completed.  This may be
     *  passed in as part of the saleInfo.  If it is not passed in then this will be a new generated value.
     */
    this.preAuth = function (saleInfo, saleRequestCallback) {
        this.ensureExternalPaymentId(saleInfo);
        delete saleInfo.tipAmount;
        if (this.verifyValidAmount(saleInfo, saleRequestCallback)) {
            this.internalTx(saleInfo, saleRequestCallback, this.preAuth_payIntentTemplate(), "payment");
        }
        return saleInfo.externalPaymentId;
    }

    /**
     * Refund AKA credit
     *
     * @param {TransactionRequest} refundInfo - amount is refunded
     * @param {Clover~transactionRequestCallback} refundRequestCallback
     */
    this.refund = function (refundInfo, refundRequestCallback) {
        if (this.verifyValidAmount(refundInfo, refundRequestCallback)) {
            refundInfo.amount = Math.abs(refundInfo.amount) * -1;
            this.internalTx(refundInfo, refundRequestCallback, this.refund_payIntentTemplate(), "credit");
        }
    }

    /**
     *
     * @private
     * @param txnInfo
     * @param errorFirstCallback
     * @returns {boolean}
     */
    this.verifyValidAmount = function (txnInfo, errorFirstCallback) {
        if (!txnInfo.hasOwnProperty("amount") || !Clover.isInt(txnInfo.amount) || (txnInfo.amount < 0)) {
            errorFirstCallback(CloverError.INVALID_DATA,
                new CloverError("paymentInfo must include 'amount',and  the value must be an integer with " +
                    "a value greater than 0"));
            return false;
        }
        return true;
    }

    /**
     * @private
     * @param {TransactionRequest} txnInfo
     * @param {Clover~transactionRequestCallback} txnRequestCallback
     * @param template
     */
    this.internalTx = function (txnInfo, txnRequestCallback, template, txnName, suppressOnScreenTips) {
        // Use a template to start with
        var payIntent = template;
        if (txnInfo.hasOwnProperty("tipAmount") && !Clover.isInt(txnInfo.tipAmount)) {
            txnRequestCallback(new CloverError(CloverError.INVALID_DATA,
                "if paymentInfo has 'tipAmount', the value must be an integer"));
            return;
        }
        if (txnInfo.hasOwnProperty("tippableAmount")) {
            if (!Clover.isInt(txnInfo.tippableAmount)) {
                txnRequestCallback(new CloverError(CloverError.INVALID_DATA,
                    "if paymentInfo has 'tippableAmount', the value must be an integer"));
                return;
            } else {
                payIntent.tippableAmount = txnInfo.tippableAmount;
            }
        }
        if (txnInfo.hasOwnProperty("employeeId")) {
            payIntent.employeeId = txnInfo.employeeId;
        }
        if (txnInfo.hasOwnProperty("vaultedCard")) {
            payIntent.vaultedCard = txnInfo.vaultedCard;
        }
        if (txnInfo.hasOwnProperty("externalPaymentId")) {
            if (txnInfo.externalPaymentId.length > 32) {
                var error = new CloverError(CloverError.INVALID_DATA, "id is invalid - '" + txnInfo.externalPaymentId + "'");
                txnRequestCallback(error, null);
                return;
            }
            payIntent.externalPaymentId = txnInfo.externalPaymentId;
        }
        /*
         The order id cannot be specified at this time.
         if (txnInfo.hasOwnProperty("orderId")) {
         payIntent.orderId = txnInfo.orderId;
         }
         */
        var autoVerifySignature = this.getAutoVerifySignature();
        if (txnInfo.hasOwnProperty("autoVerifySignature")) {
            if (txnInfo.autoVerifySignature === true) {
                autoVerifySignature = true;
            }
        }
        payIntent.amount = txnInfo.amount;
        payIntent.tipAmount = txnInfo["tipAmount"];

        // Reserve a reference to this object
        var me = this;
        // We will hold on to the signature since we are not showing it to the user.
        var signature = null;

        // Holds all the callbacks so that they can be removed later, if
        // They need to be.  Callbacks need to be removed in the 'end states'
        // that do not visit ALL the callback.
        var allCallBacks = [];

        var deviceErrorCB = function (event) {
            // Remove obsolete listeners.  This is an end state
            me.device.removeListeners(allCallBacks);
            var error = new CloverError(CloverError.DEVICE_ERROR, event);
            txnRequestCallback(error, null);
        };
        this.device.on(WebSocketDevice.DEVICE_ERROR, deviceErrorCB);
        allCallBacks.push({"event": WebSocketDevice.DEVICE_ERROR, "callback": deviceErrorCB});

        var generalErrorCB = function (message) {
            // Remove obsolete listeners.  This is an end state
            me.device.removeListeners(allCallBacks);
            var error = new CloverError(CloverError.ERROR, message);
            txnRequestCallback(error, null);
        };
        this.device.on(LanMethod.ERROR, generalErrorCB);
        allCallBacks.push({"event": LanMethod.ERROR, "callback": generalErrorCB});

        var connectionErrorCB = function (message) {
            // Remove obsolete listeners.  This is an end state
            me.device.removeListeners(allCallBacks);
            var error = new CloverError(CloverError.COMMUNICATION_ERROR, message);
            txnRequestCallback(error, null);
        };
        this.device.on(WebSocketDevice.CONNECTION_ERROR, connectionErrorCB);
        allCallBacks.push({"event": WebSocketDevice.CONNECTION_ERROR, "callback": connectionErrorCB});

        //Wire in the handler for completion to be called once.
        /**
         * Wire in automatic signature verification for now
         */
        var verifySignatureCB = function (message) {
            try {
                var payload = JSON.parse(message.payload);
                var payment = JSON.parse(payload.payment);
                // Already an object...hmmm
                signature = payload.signature;
                // This has the potential to 'stall out' the
                // sale processing if the user of the API does not register
                // a callback for this message, and verify the signature themselves.
                if (autoVerifySignature) {
                    me.device.sendSignatureVerified(payment);
                }
            } catch (error) {
                var cloverError = new CloverError(LanMethod.VERIFY_SIGNATURE,
                    "Failure attempting to send signature verification", error);
                txnRequestCallback(cloverError, {
                    "code": "ERROR",
                    "signature": signature,
                    "request": txnInfo
                });
            }
        };
        this.device.once(LanMethod.VERIFY_SIGNATURE, verifySignatureCB);
        allCallBacks.push({"event": LanMethod.VERIFY_SIGNATURE, "callback": verifySignatureCB});

        var finishOKCB = function (message) {
            // Remove obsolete listeners.  This is an end state
            me.device.removeListeners(allCallBacks);

            var payload = JSON.parse(message.payload);
            var txnInfo = JSON.parse(payload[txnName]);//payment, credit
            var callbackPayload = {};
            callbackPayload.request = payIntent;
            callbackPayload[txnName] = txnInfo;
            callbackPayload.signature = signature;
            callbackPayload.code = txnInfo.result;

            try {
                txnRequestCallback(null, callbackPayload);
            } catch (err) {
                console.log(err);
            }
            me.device.sendShowWelcomeScreen();
        };
        this.device.once(LanMethod.FINISH_OK, finishOKCB);
        allCallBacks.push({"event": LanMethod.FINISH_OK, "callback": finishOKCB});

        var finishCancelCB = function (message) {
            // Remove obsolete listeners.  This is an end state
            me.device.removeListeners(allCallBacks);

            var callbackPayload = {};
            callbackPayload.request = payIntent;
            callbackPayload.signature = signature;
            callbackPayload.code = "CANCEL";

            var error = new CloverError(CloverError.CANCELED, "Transaction canceled");
            try {
                txnRequestCallback(error, callbackPayload);
            } catch (err) {
                console.log(err);
            }
            me.device.sendShowWelcomeScreen();
        };
        this.device.once(LanMethod.FINISH_CANCEL, finishCancelCB);
        allCallBacks.push({"event": LanMethod.FINISH_CANCEL, "callback": finishCancelCB});

        try {
            this.device.sendTXStart(payIntent, suppressOnScreenTips);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.TX_START,
                "Failure attempting to send start transaction", error);
            txnRequestCallback(cloverError, {
                "code": "ERROR",
                "request": txnInfo
            });
        }
    }

    /**
     *
     * @private
     *
     * @param callbackPayload - the initial callback payload.  This is an object that will
     *  eventually be passed as data to the completionCallback.  This will add a "sent"
     *  property to this object
     * @param {requestCallback} completionCallback - called with an ACK message.  Payload is the
     *  callbackPayload with a boolean "sent" property added.
     *  @return the unique identifier that should be used when sending the message for which a ACK
     *      message is desired.
     */
    this.genericAcknowledgedCall = function (callbackPayload, completionCallback) {
        // Reserve a reference to this object
        var me = this;
        // We will generate a uuid to use in a callback
        var uuid = null;
        // Add ACK callback

        // Define the callback function just for this.  We need to define it this way
        // because we want a reference to remove it inside itself.
        var genericAckCallback = function (message) {
            // We are looking for a specific ACK callback
            if (message.id == uuid) {
                // Remove the callback as soon as possible. We only want to be
                // called once.
                me.device.removeListener(LanMethod.ACK, genericAckCallback);
                // Build up a callback data object
                if ((typeof callbackPayload == 'undefined') || (callbackPayload == null)) {
                    callbackPayload = {};
                }
                // Add in the value for successfully sent.
                // This is redundant right now, but perhaps not forever
                callbackPayload.result = {
                    "messageReceived": true
                };
                // Call the callback with the data
                try {
                    if (completionCallback) completionCallback(null, callbackPayload);
                    // Show the welcome screen after the acknowledgement.
                    // This might be removed later
                } catch (err) {
                    console.log(err);
                }
                me.device.sendShowWelcomeScreen();
            }
        };
        // Generate the uuid so we can filter properly
        uuid = CloverID.guid();
        // Register the callback.
        this.device.on(LanMethod.ACK, genericAckCallback);
        // return the uuid so the caller of this function can use
        // it when sending a message.
        return uuid;
    }

    /**
     *
     * @param {Payment} payment - the payment information returned from a call to 'sale'.
     *  this can be truncated to be only { "id": paymentId, "order": {"id": orderId}}
     * @param {VoidReason} REASON - the reason for the void.
     * @param {requestCallback} completionCallback
     */
    this.voidTransaction = function (payment, voidReason, completionCallback) {
        var callbackPayload = {"request": {"payment": payment, "voidReason": voidReason}};

        // Temporary - Will be replaced by employee on backend
        if (!payment.hasOwnProperty("employee")) {
            payment["employee"] = {
                "id": "DFLTEMPLOYEE"
            }
        }

        var uuid = this.genericAcknowledgedCall(callbackPayload, completionCallback);
        try {
            this.device.sendVoidPayment(payment, voidReason, uuid);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.VOID_PAYMENT,
                "Failure attempting to send void", error);
            completionCallback(cloverError, {
                "code": "ERROR",
                "request": callbackPayload
            });
        }
    }

    /**
     * Refund from a previous payment.
     * @param {RefundRequest} refundRequest - the refund request
     * @param {requestCallback} completionCallback
     */
    this.refundPayment = function (refundRequest, completionCallback) {
        var callbackPayload = {"request": refundRequest, "response": {}};
        var txnName = 'refund';

        var me = this;
        // Holds all the callbacks so that they can be removed later, if
        // They need to be.  Callbacks need to be removed in the 'end states'
        // that do not visit ALL the callback.
        var allCallBacks = [];

        // TODO:  Remove in future version, CLOVER-17724
        // This information will be in the finish_* messages returned.
        var refundResponseCB = function (message) {
            if (completionCallback) {
                var payload = JSON.parse(message.payload);

                callbackPayload.response.message = payload['message'];
                callbackPayload.response.reason = payload['reason'];
            }
        }
        this.device.once(LanMethod.REFUND_RESPONSE, refundResponseCB);
        allCallBacks.push({"event": LanMethod.REFUND_RESPONSE, "callback": refundResponseCB});

        var finishOKCB = function (message) {
            // Remove obsolete listeners.  This is an end state
            me.device.removeListeners(allCallBacks);
            try {
                if (completionCallback) {
                    var payload = JSON.parse(message.payload);
                    var txnInfo = JSON.parse(payload[txnName]);//refund
                    callbackPayload.response[txnName] = txnInfo;
                    callbackPayload.response.code = "OK"; // finish ok

                    completionCallback(null, callbackPayload);
                }
            } catch (err) {
                console.log(err);
            }
            me.device.sendShowWelcomeScreen();
        };
        this.device.once(LanMethod.FINISH_OK, finishOKCB);
        allCallBacks.push({"event": LanMethod.FINISH_OK, "callback": finishOKCB});

        var finishCancelCB = function (message) {
            // Remove obsolete listeners.  This is an end state
            me.device.removeListeners(allCallBacks);
            try {
                if (completionCallback) {
                    callbackPayload.response.code = "CANCEL";

                    var error = new CloverError(CloverError.CANCELED, "Transaction canceled");
                    completionCallback(error, callbackPayload);
                }
            } catch (err) {
                console.log(err);
            }
            me.device.sendShowWelcomeScreen();
        };
        this.device.once(LanMethod.FINISH_CANCEL, finishCancelCB);
        allCallBacks.push({"event": LanMethod.FINISH_CANCEL, "callback": finishCancelCB});

        try {
            this.device.sendRefund(refundRequest.orderId, refundRequest.paymentId, refundRequest["amount"]);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.REFUND_REQUEST,
                "Failure attempting to send refund request", error);
            callbackPayload["code"] = "ERROR";
            completionCallback(cloverError, callbackPayload);
        }
    }

    /**
     * Print an array of strings on the device
     *
     * @param {string[]} textLines - an array of strings to print
     * @param {requestCallback} [completionCallback]
     */
    this.print = function (textLines, completionCallback) {
        var callbackPayload = {"request": textLines};
        var uuid = null;
        if (completionCallback) {
            uuid = this.genericAcknowledgedCall(callbackPayload, completionCallback);
        }
        try {
            this.device.sendPrintText(textLines, uuid);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.PRINT_TEXT,
                "Failure attempting to print text", error);
            if (completionCallback) {
                completionCallback(cloverError, {
                    "code": "ERROR",
                    "request": callbackPayload
                });
            }
        }
    }

    /**
     * Print a receipt from a previous transaction.
     * @param printRequest
     * @param completionCallback
     */
    this.printReceipt = function (printRequest, completionCallback) {
        var callbackPayload = {"request": printRequest};

        var finishCancelCB = function (message) {
            try {
                completionCallback(null, callbackPayload);
            } catch (err) {
                console.log(err);
            }
            // We could let them do this
            this.device.sendShowWelcomeScreen();
        }.bind(this);
        this.device.once(LanMethod.FINISH_CANCEL, finishCancelCB);

        try {
            this.device.sendShowPaymentReceiptOptions(printRequest.orderId, printRequest.paymentId);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.SHOW_PAYMENT_RECEIPT_OPTIONS,
                "Failure attempting to print receipt", error);
            completionCallback(cloverError, {
                "code": "ERROR",
                "request": callbackPayload
            });
        }
    }

    /**
     * Prints an image on the receipt printer of the device.
     *
     * The size of the image should be limited, and the optimal
     * width of the image is 384 pixals.
     *
     * @param img an HTML DOM IMG object.
     * @param {requestCallback} [completionCallback]
     */
    this.printImage = function (img, completionCallback) {
        var callbackPayload = {"request": {"img": {"src": img.src}}};
        var uuid = null;
        if (completionCallback) {
            uuid = this.genericAcknowledgedCall(callbackPayload, completionCallback);
        }
        try {
            this.device.sendPrintImage(img, uuid);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.PRINT_IMAGE,
                "Failure attempting to print image", error);
            if (completionCallback) {
                completionCallback(cloverError, {
                    "code": "ERROR",
                    "request": callbackPayload
                });
            }
        }
    }

    /**
     * Prints an image on the receipt printer of the device.
     *
     * The size of the image should be limited, and the optimal
     * width of the image is 384 pixals.
     *
     * @param img an HTML DOM IMG object.
     * @param {requestCallback} [completionCallback]
     */
    this.printImageFromURL = function (img, completionCallback) {
        var callbackPayload = {"request":{"img":{"url": img }}};
        var uuid = null;
        if(completionCallback) {
            uuid = this.genericAcknowledgedCall(callbackPayload, completionCallback);
        }
        try {
            this.device.sendPrintImageFromURL(img, uuid);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.PRINT_IMAGE,
                "Failure attempting to print image", error);
            if(completionCallback) {
                completionCallback(cloverError, {
                    "code": "ERROR",
                    "request": callbackPayload
                });
            }
        }
    }

    /**
     * Not yet implemented
     * @param {requestCallback} completionCallback
     */
    this.saleWithCashback = function (saleInfo, completionCallback) {
        completionCallback(new CloverError(CloverError.NOT_IMPLEMENTED, "Not yet implemented"));
    }

    /**
     * Sends an escape code to the device.  The behavior of the device when this is called is
     * dependant on the current state of the device.
     * @param {requestCallback} [completionCallback]
     */
    this.sendCancel = function (completionCallback) {
        // Note - this is a pattern for sending keystrokes ot the device.
        // Available keystrokes can be found in KeyPress.
        var callbackPayload = {"request": "cancel"};
        var uuid = null;
        if (completionCallback) {
            uuid = this.genericAcknowledgedCall(callbackPayload, completionCallback);
        }
        try {
            this.device.sendKeyPress(KeyPress.ESC, uuid);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.KEY_PRESS,
                "Failure attempting to cancel", error);
            if (completionCallback) {
                completionCallback(cloverError, {
                    "code": "ERROR",
                    "request": callbackPayload
                });
            }
            console.log(cloverError);
        }
    }

    /**
     * Opens the cash drawer
     *
     * @param {string} reason - the reason the cash drawer was opened.
     * @param {requestCallback} [completionCallback]
     */
    this.openCashDrawer = function (reason, completionCallback) {
        // Note - this is a pattern for sending keystrokes ot the device.
        // Available keystrokes can be found in KeyPress.
        var callbackPayload = {"request": {"reason": reason}};
        var uuid = null;
        if (completionCallback) {
            uuid = this.genericAcknowledgedCall(callbackPayload, completionCallback);
        }
        try {
            this.device.sendOpenCashDrawer(reason, uuid);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.OPEN_CASH_DRAWER,
                "Failure attempting to open the cash drawer", error);
            if (completionCallback) {
                completionCallback(cloverError, {
                    "code": "ERROR",
                    "request": callbackPayload
                });
            }
            console.log(cloverError);
        }
    }

    /**
     * @param {TipAdjustRequest} tipAdjustRequest - the refund request
     * @param {requestCallback} completionCallback
     */
    this.tipAdjust = function (tipAdjustRequest, completionCallback) {
        var callbackPayload = {"request": tipAdjustRequest};

        var tipAdjustCB = function (message) {
            var payload = JSON.parse(message.payload);
            callbackPayload["response"] = payload;
            callbackPayload["code"] = "SUCCESS";

            completionCallback(null, callbackPayload);
        }.bind(this);
        this.device.once(LanMethod.TIP_ADJUST_RESPONSE, tipAdjustCB);

        try {
            this.device.sendTipAdjust(tipAdjustRequest.orderId, tipAdjustRequest.paymentId, tipAdjustRequest["tipAmount"]);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.TIP_ADJUST,
                "Failure attempting to send tip adjust", error);
            callbackPayload["code"] = "ERROR";
            completionCallback(cloverError, callbackPayload);
        }
    }

    /**
     *
     * @param {requestCallback} completionCallback
     */
    this.getLastMessage = function (completionCallback) {
        var callbackPayload = {"request": {}};

        var lastMessageCB = function (message) {
            var payload = JSON.parse(message.payload);
            callbackPayload["response"] = payload;

            completionCallback(null, callbackPayload);
        }.bind(this);
        this.device.once(LanMethod.LAST_MSG_RESPONSE, lastMessageCB);

        try {
            this.device.sendLastMessageRequest();
        } catch (error) {
            var cloverError = new CloverError(LanMethod.LAST_MSG_REQUEST,
                "Failure attempting to get last message sent", error);
            completionCallback(cloverError, {
                "code": "ERROR",
                "request": callbackPayload
            });
        }
    }

    /**
     * Capture a card for future usage in a sale or auth request.
     *
     * @param {requestCallback} completionCallback
     */
    this.vaultCard = function (cardEntryMethods, completionCallback) {
        var callbackPayload = {"request": {"cardEntryMethods": cardEntryMethods}};

        var vaultCardCB = function (message) {
            var payload = JSON.parse(message.payload);
            callbackPayload["response"] = payload;

            completionCallback(null, callbackPayload);
        }.bind(this);
        this.device.once(LanMethod.VAULT_CARD_RESPONSE, vaultCardCB);

        try {
            this.device.sendVaultCard(cardEntryMethods);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.VAULT_CARD,
                "Failure attempting to capture card", error);
            completionCallback(cloverError, {
                "code": "ERROR",
                "request": callbackPayload
            });
        }
    }

    /**
     *
     * @param {CapturePreAuthRequest} request
     * @param completionCallback
     */
    this.capturePreAuth = function (request, completionCallback) {
        var callbackPayload = {"request": request};

        // Validate request has contents
        if (!request.hasOwnProperty("paymentId")) {
            completionCallback(new CloverError(CloverError.INVALID_DATA, "missing paymentId"), null);
        }
        if (!request.hasOwnProperty("amount")) {
            completionCallback(new CloverError(CloverError.INVALID_DATA, "missing amount"), null);
        }

        var capturePreAuthCB = function (message) {
            var payload = JSON.parse(message.payload);
            callbackPayload["response"] = payload;
            completionCallback(null, callbackPayload);
        }.bind(this);
        this.device.once(LanMethod.CAPTURE_PREAUTH_RESPONSE, capturePreAuthCB);

        try {
            this.device.sendCapturePreAuth(request.orderId, request.paymentId, request.amount, request["tipAmount"]);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.LAST_MSG_REQUEST,
                "Failure attempting to get last message sent", error);
            completionCallback(cloverError, {
                "code": "ERROR",
                "request": callbackPayload
            });
        }
    }

    /**
     *
     * @param {CloseoutRequest} request
     * @param completionCallback
     */
    this.closeout = function (request, completionCallback) {
        if (!request)request = {};
        var callbackPayload = {"request": request};

        // Validate request has contents
        if (request.hasOwnProperty("allowOpenTabs")) {
            if (!typeof(request.allowOpenTabs) === "boolean")
                completionCallback(new CloverError(CloverError.INVALID_DATA, "allowOpenTabs must be true or false"), null);
        }

        var closeoutCB = function (message) {
            var payload = JSON.parse(message.payload);
            callbackPayload["response"] = payload;
            completionCallback(null, callbackPayload);
        }.bind(this);
        this.device.once(LanMethod.CLOSEOUT_RESPONSE, closeoutCB);

        try {
            // 'batchId' is left undocumented for now, and not supported.  Only
            // Current open batches will be closed out.
            this.device.sendCloseout(request["allowOpenTabs"], request["batchId"]);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.CLOSEOUT_RESPONSE,
                "Failure attempting to send closeout request", error);
            completionCallback(cloverError, {
                "code": "ERROR",
                "request": callbackPayload
            });
        }
    }

    /**
     * Puts a message on the device screen
     *
     * @param {string} message - the message to put on the device screen.
     * @param {requestCallback} [completionCallback]
     */
    this.showMessage = function (message, completionCallback) {
        // Note - this is a pattern for sending keystrokes ot the device.
        // Available keystrokes can be found in KeyPress.
        var callbackPayload = {"request": {"message": message}};
        var uuid = null;
        if (completionCallback) {
            uuid = this.genericAcknowledgedCall(callbackPayload, completionCallback);
        }
        try {
            this.device.sendTerminalMessage(message, uuid);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.TERMINAL_MESSAGE,
                "Failure attempting to put message on device", error);
            if (completionCallback) {
                completionCallback(cloverError, {
                    "code": "ERROR",
                    "request": callbackPayload
                });
            }
            console.log(cloverError);
        }
    }

    /**
     * Puts the device in the welcome screen
     *
     * @param {requestCallback} [completionCallback]
     */
    this.showWelcomeScreen = function (completionCallback) {
        // Note - this is a pattern for sending keystrokes ot the device.
        // Available keystrokes can be found in KeyPress.
        var callbackPayload = {"request": {}};
        var uuid = null;
        if (completionCallback) {
            uuid = this.genericAcknowledgedCall(callbackPayload, completionCallback);
        }
        try {
            this.device.sendShowWelcomeScreen(uuid);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.SHOW_WELCOME_SCREEN,
                "Failure attempting to put message on device", error);
            if (completionCallback) {
                completionCallback(cloverError, {
                    "code": "ERROR",
                    "request": callbackPayload
                });
            }
            console.log(cloverError);
        }
    }

    /**
     * Puts the device in the 'thank you' screen
     *
     * @param {requestCallback} [completionCallback]
     */
    this.showThankYouScreen = function (completionCallback) {
        // Note - this is a pattern for sending keystrokes ot the device.
        // Available keystrokes can be found in KeyPress.
        var callbackPayload = {"request": {}};
        var uuid = null;
        if (completionCallback) {
            uuid = this.genericAcknowledgedCall(callbackPayload, completionCallback);
        }
        try {
            this.device.sendShowThankYouScreen(uuid);
        } catch (error) {
            var cloverError = new CloverError(LanMethod.SHOW_THANK_YOU_SCREEN,
                "Failure attempting to put message on device", error);
            if (completionCallback) {
                completionCallback(cloverError, {
                    "code": "ERROR",
                    "request": callbackPayload
                });
            }
            console.log(cloverError);
        }
    }

    //////////

    ///**
    // * Not yet implemented
    // */
    //this.getSiteTotals = function() {
    //    throw new Error("Not yet implemented");
    //}
    //
    ///**
    // * Not yet implemented
    // */
    //this.rebootDevice = function() {
    //    throw new Error("Not yet implemented");
    //}
    //
    ///**
    // * Not yet implemented
    // */
    //this.balance = function() {
    //    throw new Error("Not yet implemented");
    //}
    //
    ///**
    // * Not yet implemented
    // */
    //this.getCardData = function() {
    //    throw new Error("Not yet implemented");
    //}
}

// Below are utility methods that can be located anywhere.
// Want to make sure we have the namespace, so putting in Clover.
/**
 * @private
 * @param value
 * @returns {boolean}
 */
Clover.isInt = function(value) {
    var x;
    if (isNaN(value)) {
        return false;
    }
    x = parseFloat(value);
    return (x | 0) === x;
}

Clover.setCookie = function(cname, cvalue, exdays) {
    var d = new Date();
    d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
    var expires = "expires=" + d.toUTCString();
    document.cookie = cname + "=" + cvalue + "; " + expires;
}

Clover.getCookie = function(cname) {
    var name = cname + "=";
    var ca = document.cookie.split(';');
    for (var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1);
        if (c.indexOf(name) == 0) return c.substring(name.length, c.length);
    }
    return "";
}

Clover.writeConfigurationToCookie = function (configuration, saveURL) {
    var cvalue = JSON.stringify(configuration);
    var jsonValue = JSON.parse(cvalue);
    if (!saveURL) {
        delete jsonValue.deviceURL;
    }
    cvalue = JSON.stringify(jsonValue);

    var exdays = 2;
    if (!this.configurationName)this.configurationName = "CLOVER_DEFAULT";
    Clover.setCookie(this.configurationName, cvalue, exdays);
}

Clover.loadConfigurationFromCookie = function (configurationName) {
    // We have no configuration at all.  Try to get it from a cookie
    var configuration = null;
    var cvalue = Clover.getCookie(configurationName);
    if (cvalue) {
        configuration = JSON.parse(cvalue);
    }
    return configuration;
}


/**
 * This callback type is called `requestCallback` and is displayed as a global symbol.  This type
 * of callback adheres to the Node.js convention of 'Error-first' callbacks.
 *
 *
 * The first argument of the callback is always reserved for an error object.
 * On a successful response, the ‘err’ argument is null. Call the callback and include the successful data only.
 *
 * On an unsuccessful response, the ‘err’ argument is set. Call the callback with an actual error object. The
 * error should describe what happened and include enough information to tell the callback what went wrong. Data
 * can still be returned in the other arguments as well, but generally the error is passed alone.
 * @see http://fredkschott.com/post/2014/03/understanding-error-first-callbacks-in-node-js/
 *
 * @callback requestCallback
 * @param {Error} [error] - null iff there was no error, else an object that contains a code and a message text
 * @param {Object} [result] - data that results from the function.  This is a hash of information.  There will be a
 *  code within the object that indicates the operation completion status.  This may be null, depending on the
 *  nature of the call, and the error state.
 */

/**
 * A payment
 *
 * @typedef {Object} TransactionRequest
 * @property {integer} amount - the amount of a sale or refund, including tax
 * @property {integer} [tipAmount] - the amount of a tip.  Added to the amount for the total.  Valid for sale operations
 * @property {integer} [tippableAmount] - the amount that calculated tips are based on.  If not set then 'amount'
 *  is used. Valid for sale operations
 * @property {string} [employeeId] - the valid Clover id of an employee recognized by the device.  Represents the
 *  employee making this sale or refund.
 * @property {boolean} [autoVerifySignature] - optional override to allow either automatic signature verification
 *  {true}, or expect that the caller has registered a listener for the request for signature verification {false}.
 *  This will override the internal object flag autoVerifySignature.
 * @property {string} [requestId] - optional CloverID compatible identifier used for the payment once the transaction
 *  is completed.  See @CloverID
 * @property {boolean} [isPreAuth] - valid for auth calls.  If set, the payment will be made as a pre authorization.
 */

/**
 * The response to a sale or naked refund
 *
 * @typedef {Object} TransactionResponse
 * @property {string} code - the result code for the transaction - "SUCCESS", "CANCEL", "ERROR"
 * @property {Payment} payment - the payment information
 * @property {Credit} credit - the payment information
 * @property {Signature} [signature] - the signature, if present
 * @property {TransactionRequest} [request] - the request that resulted in this response
 */

/**
 * The callback on a sale
 *
 * @callback Clover~transactionRequestCallback
 * @param {Error} [error] - null iff there was no error, else an object that contains a code and a message text
 * @param {TransactionResponse} result - data that results from the function.
 */

/**
 * @typedef {Object} CloseoutRequest
 * @property {boolean} [allowOpenTabs] - if true, indicates that a closeout can proceed, even if open tabs are
 *  present.  Defaults to false.
 */

/**
 * @typedef {Object} RefundRequest
 * @property {string} orderId - the id of the order to refund
 * @property {string} paymentId - the id of the payment on the order to refund
 * @property {number} [amount] - the amount to refund.  If not included, the full payment is refunded.  The amount
 *  cannot exceed the original payment, and additional constraints apply to this (EX: if a partial refund
 *  has already been performed then the amount canot exceed the remaining payment amount).
 */

/**
 * @typedef {Object} CapturePreAuthRequest
 * @property {string} paymentId - the id of the payment to capture
 * @property {number} amount - the final amount ofthe payment less any included tip
 * @property {number} [tipAmount] - the amount of the tip.
 */

/**
 * @typedef {Object} TipAdjustRequest
 * @property {string} orderId - the id of the order to adjust
 * @property {string} paymentId - the id of the payment on the order to adjust
 * @property {number} tipAmount - the amount to adjust.
 */

/**
 * @typedef {Object} Payment
 * @property {string} result - the result code for the transaction - "SUCCESS", "CANCEL"
 * @property {integer} [createdTime] - the time in milliseconds that the transaction successfully completed
 * @property {CardTransaction} [cardTransaction] - successful transaction information
 * @property {integer} [amount] - the amount of the transaction, including tax
 * @property {integer} [tipAmount] - added tip amount
 * @property {Object} [order] - order information. Ex: id - the order id
 * @property {Object} [employee] - employee information. Ex: id - the employee id
 */

/**
 * @typedef {Object} Credit
 * @property {integer} [amount] - the amount of the transaction, including tax
 * @property {integer} [createdTime] - the time in milliseconds that the transaction successfully completed
 * @property {Tender} [tender] - refund information
 * @property {Object} [orderRef] - order information. Ex: id - the order id
 * @property {Object} [employee] - employee information. Ex: id - the employee id
 * @property {CardTransaction} [cardTransaction] - successful transaction information
 */

/**
 * @typedef {Object} Tender
 * @property {string} id - the tender id
 * @property {string} label - the label that describes the tender
 */

/**
 * @typedef {Object} CardTransaction
 * @property {integer} authcode - the authorization code
 * @property {string} entryType - SWIPED, KEYED, VOICE, VAULTED, OFFLINE_SWIPED, OFFLINE_KEYED, EMV_CONTACT,
 *  EMV_CONTACTLESS, MSD_CONTACTLESS, PINPAD_MANUAL_ENTRY
 * @property {Object} extra - additional information on the transaction.  EX: cvmResult - "SIGNATURE"
 * @property {string} state - PENDING, CLOSED
 * @property {string} referenceId
 * @property {string} type - AUTH, PREAUTH, PREAUTHCAPTURE, ADJUST, VOID, VOIDRETURN, RETURN, REFUND,
 *  NAKEDREFUND, GETBALANCE, BATCHCLOSE, ACTIVATE, BALANCE_LOCK, LOAD, CASHOUT, CASHOUT_ACTIVE_STATUS,
 *  REDEMPTION, REDEMPTION_UNLOCK, RELOAD
 * @property {integer} transactionNo
 * @property {integer} last4 - the last 4 digits of the card
 * @property {string} cardType - VISA, MC, AMEX, DISCOVER, DINERS_CLUB, JCB, MAESTRO, SOLO, LASER,
 *  CHINA_UNION_PAY, CARTE_BLANCHE, UNKNOWN, GIFT_CARD, EBT
 *
 */

/**
 * @typedef {Object} Signature
 * @property {Stroke[]} strokes - the strokes of the signature.  A series of points representing a single contiguous
 *  line
 * @property {integer} height - the pixal height of the canvas area needed to correctly represent the signature
 * @property {integer} width - the pixal width of the canvas area needed to correctly represent the signature
 *
 */

/**
 * @typedef {Object} Stroke - A series of points representing a single contiguous line
 * @property {Point[]} points
 */

/**
 * @typedef {Object} Point
 * @property {integer} x - the x coordinate location of the point in pixals
 * @property {integer} y - the y coordinate location of the point in pixals
 */


/**
 * The configuration for the Clover api object.  This encapsulates the different ways that the Clover object can
 * be configured for proper access to the device.
 *
 * <p>
 *     Possible configurations:<br/>
 *     <ol>
 *          <li>deviceURL</li>
 *          <li>oauthToken, domain, merchantId, deviceSerialId</li>
 *          <li>clientId, domain, merchantId, deviceId (Requires log in to Clover server)</li>
 *          <li>clientId, domain, merchantId, deviceSerialId (Requires log in to Clover server)</li>
 *     </ol>
 * </p>
 *
 * @typedef {Object} CloverConfig
 * @property {string} [deviceURL] - the web socket url to use when connecting to the device.  Optional
 *  if other configuration values allow this to be obtained.
 * @property {string} [oauthToken] - the authentication token used when communicating with the clover cos
 *  server.  Required if deviceURL is not set. Optional if other configuration values allow this
 *  to be obtained.
 * @property {string} [domain] - the url to the clover cos server.
 * @property {string} [merchantId] - the merchant id.
 * @property {string} [deviceSerialId] - the serial id of the device to use.
 * @property {string} [clientId] - the Clover application id to use when obtaining the oauth token.
 * @property {boolean} [autoVerifySignature] - if set to false, a callback must be registered for
 *  signature verification requests.  This defaults to true.
 * @property {boolean} [disableRestartTransactionWhenFailed] - if set to true, when the device times out
 *  during a transaction, it will return to the 'Welcome' screen when the customer selects 'ok'
 * @property {boolean} [remotePrint] - if set to true, then when the user selects "print" on the print receipt
 *  screen after a transaction, a PRINT_PAYMENT message will be sent from the device to the API.  To get the
 *  message, a listener must be registered via Clover.device.on(LanMethod.PRINT_PAYMENT, ...)
 */
