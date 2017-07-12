var events        = require('events');
var util          = require('util');

var $             = require('nodobjc');
var debug         = require('debug')('mutable-characteristic');

var $util         = require('./util');

$.import('Foundation');

function MutableCharacteristic(uuid, properties, value, permissions, descriptors) {
  this.uuid        = uuid;
  this.properties  = properties;
  this.value       = value;
  this.descriptors = descriptors;

  var $uuid        = $util.to$Uuid(uuid);
  var $properties  = properties;
  var $value       = $util.bufferTo$Data(value);
  var $permissions = permissions;

  this.$ = $.CBMutableCharacteristic('alloc')('initWithType', $uuid,
                                              'properties', $properties,
                                              'value', $value,
                                              'permissions', $permissions);

  if (descriptors) {
    var $descriptors = $.NSMutableArray('alloc')('init');

    descriptors.forEach(function(descriptor) {
      $descriptors('addObject', descriptor.$);
    });

    this.$('setDescriptors', $descriptors);
  }
}

util.inherits(MutableCharacteristic, events.EventEmitter);

MutableCharacteristic.prototype.toString = function() {
  return JSON.stringify({
    uuid: this.uuid,
    properties: this.properties,
    value: this.value,
    descriptors: this.descriptors
  });
};

MutableCharacteristic.prototype.onAdded = function() {
  this.identifier = $util.identifierFor$MutableAttribute(this.$);

  if (this.descriptors) {
    this.descriptors.forEach(function(descriptor) {
      descriptor.onAdded();
    });
  }

  this.emit('added');
};

/*
typedef enum {
   CBATTErrorSuccess = 0x00,
   CBATTErrorInvalidHandle = 0x01,
   CBATTErrorReadNotPermitted = 0x02,
   CBATTErrorWriteNotPermitted = 0x03,
   CBATTErrorInvalidPdu = 0x04,
   CBATTErrorInsufficientAuthentication = 0x05,
   CBATTErrorRequestNotSupported = 0x06,
   CBATTErrorInvalidOffset = 0x07,
   CBATTErrorInsufficientAuthorization = 0x08,
   CBATTErrorPrepareQueueFull = 0x09,
   CBATTErrorAttributeNotFound = 0x0A,
   CBATTErrorAttributeNotLong = 0x0B,
   CBATTErrorInsufficientEncryptionKeySize = 0x0C,
   CBATTErrorInvalidAttributeValueLength = 0x0D,
   CBATTErrorUnlikelyError = 0x0E,
   CBATTErrorInsufficientEncryption = 0x0F,
   CBATTErrorUnsupportedGroupType = 0x10,
   CBATTErrorInsufficientResources = 0x11,
} CBATTError;
*/

MutableCharacteristic.prototype.onReadRequest = function(transactionId, offset) {
  debug('onReadRequest: %d', offset);

  this.peripheralManager.respondToRequest(transactionId, 0x0e);
};

MutableCharacteristic.prototype.onWriteRequest = function(transactionId, offset, value, ignoreResponse) {
  debug('onWriteRequest: %d %s %d', offset, value.toString('hex'), ignoreResponse);

  this.peripheralManager.respondToRequest(transactionId, 0x0e);
};

MutableCharacteristic.prototype.onSubscribe = function(centralIdentifier, maximumUpdateValueLength) {
  debug('onSubscribe: %s %d', centralIdentifier, maximumUpdateValueLength);
};

MutableCharacteristic.prototype.onUnsubscribe = function(centralIdentifier) {
  debug('onUnsubscribe: %s', centralIdentifier);
};

MutableCharacteristic.prototype.onValueUpdate = function() {
  debug('onValueUpdate');
};

module.exports = MutableCharacteristic;
