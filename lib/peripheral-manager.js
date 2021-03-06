var events                    = require('events');
var util                      = require('util');

var ffi                       = require('ffi');
var $                         = require('nodobjc');
var reemit                    = require('re-emitter');

var PeripheralManagerDelegate = require('./peripheral-manager-delegate');
var $util                     = require('./util');

var localAddress              = require('./local-address');
var uuidToAddress             = require('./uuid-to-address');


$.import('Foundation');
$.import('CoreBluetooth');

var libdispatch = ffi.Library('/usr/lib/system/libdispatch', {
  'dispatch_queue_create': ['pointer', ['string', 'int']]
});

$.CBPeripheralManager.addMethod('xpcConnection:didReceiveMsg:argsSwizzled:', { retval: 'v', args: [ '@', ':', '@', 'i', '@'] }, function($self, $_cmd, $arg1, $arg2, $arg3) {
  $self('xpcConnection', $arg1, 'didReceiveMsg', $arg2, 'argsSwizzled', $arg3);

  if ($arg2 === 53) {
    var $deviceUUID = $util.objectForKey($arg3, 'kCBMsgArgDeviceUUID');
    var $mtu        = $util.objectForKey($arg3, 'kCBMsgArgATTMTU');

    process.nextTick(function($deviceUUID, $mtu) {
      $self('delegate')('peripheralManager', $self, 'central', $deviceUUID, 'didExchangeMTU', $mtu);
    }.bind(this, $deviceUUID, $mtu));
  } else if ($arg2 === 23) {
    var $attributeID = $util.objectForKey($arg3, 'kCBMsgArgAttributeID');

    process.nextTick(function($attributeID) {
      $self('delegate')('peripheralManager', $self, 'didUpdateValueForCharacteristic', $attributeID);
    }.bind(this, $attributeID));
  }
});

$.CBPeripheralManager.getInstanceMethod('xpcConnection:didReceiveMsg:args:').exchangeImplementations($.CBPeripheralManager.getInstanceMethod('xpcConnection:didReceiveMsg:argsSwizzled:'));

function PeripheralManager() {
  this.delegate  = new PeripheralManagerDelegate();
  this._services = [];
  this._pendingRequests = {};

  reemit(this.delegate, this, [
    'stateUpdate',
    'advertisingStart'
  ]);

  this.delegate.on('serviceAdded', this._onServiceAdded.bind(this));
  this.delegate.on('readRequest', this._onReadRequest.bind(this));
  this.delegate.on('writeRequests', this._onWriteRequests.bind(this));
  this.delegate.on('mtuChange', this._onMtuChange.bind(this));
  this.delegate.on('subscribe', this._onSubscribe.bind(this));
  this.delegate.on('unsubscribe', this._onUnsubscribe.bind(this));
  this.delegate.on('valueUpdate', this._onValueUpdate.bind(this));

  localAddress(function(address) {
    if (address) {
      this.emit('address', address);
    }

    this._dispatchQueue = libdispatch.dispatch_queue_create('node-core-bluetooth', 0);
    this.$ = $.CBPeripheralManager('alloc')('initWithDelegate', this.delegate.$, 'queue', this._dispatchQueue);
  }.bind(this));
 }

util.inherits(PeripheralManager, events.EventEmitter);

PeripheralManager.prototype.startAdvertising = function(advertisementData) {
  var $advertisementData = $.NSMutableDictionary('alloc')('init');

  if (advertisementData.localName) {
    var $localName = $(advertisementData.localName);

    $util.$setObjectForKey($advertisementData, $localName, 'kCBAdvDataLocalName');
  }

  if (advertisementData.serviceUuids) {
    var $serviceUuids = $util.to$Uuids(advertisementData.serviceUuids);

    $util.$setObjectForKey($advertisementData, $serviceUuids, 'kCBAdvDataServiceUUIDs');
  }

  if (advertisementData.appleBeacon) {
    var $appleBeacon = $util.bufferTo$Data(advertisementData.appleBeacon);

    $util.$setObjectForKey($advertisementData, $appleBeacon, 'kCBAdvDataAppleBeaconKey');
  }

  if (advertisementData.appleMfgData) {
    var $appleMfgData = $util.bufferTo$Data(advertisementData.appleMfgData);

    $util.$setObjectForKey($advertisementData, $appleMfgData, 'kCBAdvDataAppleMfgData');
  }

  this.$('startAdvertising', $advertisementData);
};

PeripheralManager.prototype.stopAdvertising = function() {
  this.$('stopAdvertising');
};

PeripheralManager.prototype.addService = function(mutableService) {
  this.$('addService', mutableService.$);

  mutableService.identifier = $util.identifierFor$MutableAttribute(mutableService.$);

  this._services.push(mutableService);
};

PeripheralManager.prototype.removeService = function(mutableService) {
  this.$('removeService', mutableService);
};

PeripheralManager.prototype.removeAllServices = function() {
  this.$('removeAllServices');
};

PeripheralManager.prototype.respondToRequest = function(transactionId, result, value) {
  var $request = this._pendingRequests[transactionId];
  var $value   = $util.bufferTo$Data(value);

  $request('setValue', $value);

  $request('release');

  delete this._pendingRequests[transactionId];

  this.$('respondToRequest', $request, 'withResult', result);
};

// - (void)setDesiredConnectionLatency:(CBPeripheralManagerConnectionLatency)latency forCentral:(CBCentral *)central

PeripheralManager.prototype.updateValueForCharacteristic = function(characteristic, value) {
  var $value = $util.bufferTo$Data(value);

  return this.$('updateValue', $value, 'forCharacteristic', characteristic.$, 'onSubscribedCentrals', null);
};

PeripheralManager.prototype._onServiceAdded = function(serviceIdentifier, error) {
  this._forServiceIdentifier(serviceIdentifier, function(service) {
    this.emit('serviceAdded', service, error);

    service.onAdded(error);
  }.bind(this));
};

PeripheralManager.prototype._onReadRequest = function($request) {
  var transactionId            = $util.toInt($request('transactionID')); // private API
  var characteristicIdentifier = $util.identifierFor$MutableAttribute($request('characteristic'));
  var offset                   = $request('offset');

  this._pendingRequests[transactionId] = $request;

  this._forCharacteristicIdentifier(characteristicIdentifier, function(characteristic) {
    characteristic.peripheralManager = this;
    characteristic.onReadRequest(transactionId, offset);
  }.bind(this));
};

PeripheralManager.prototype._onWriteRequests = function($requests) {
  $util.$arrayForEach($requests, function($request) {
    // TODO: do all $requests have the same transaction id?
    var transactionId            = $util.toInt($request('transactionID')); // private API
    var characteristicIdentifier = $util.identifierFor$MutableAttribute($request('characteristic'));
    var offset                   = $request('offset');
    var value                    = $util.toBuffer($request('value'));
    var ignoreResponse           = $request('ignoreResponse');

    this._pendingRequests[transactionId] = $request;

    this._forCharacteristicIdentifier(characteristicIdentifier, function(characteristic) {
      characteristic.peripheralManager = this;
      characteristic.onWriteRequest(transactionId, offset, value, ignoreResponse);
    }.bind(this));
  }.bind(this));

  $requests('release');
};

PeripheralManager.prototype._onMtuChange = function(centralIdentifier, mtu) {
  var address = uuidToAddress(centralIdentifier);

  this.emit('accept', centralIdentifier, address);
  this.emit('mtuChange', mtu);
};

PeripheralManager.prototype._onSubscribe = function(centralIdentifier, maximumUpdateValueLength, characteristicIdentifier) {
  this._forCharacteristicIdentifier(characteristicIdentifier, function(characteristic) {
    characteristic.peripheralManager = this;
    characteristic.onSubscribe(centralIdentifier, maximumUpdateValueLength);
  }.bind(this));
};

PeripheralManager.prototype._onUnsubscribe = function(centralIdentifier, characteristicIdentifier) {
  this._forCharacteristicIdentifier(characteristicIdentifier, function(characteristic) {
    characteristic.onUnsubscribe(centralIdentifier);
  }.bind(this));
};

PeripheralManager.prototype._onValueUpdate = function(characteristicIdentifier) {
  this._forCharacteristicIdentifier(characteristicIdentifier, function(characteristic) {
    characteristic.onValueUpdate();
  }.bind(this));
};

PeripheralManager.prototype._forServiceIdentifier = function(serviceIdentifier, callback) {
  this._services.forEach(function(service) {
    if (service.identifier === serviceIdentifier) {
      callback(service);
    }
  });
};

PeripheralManager.prototype._forCharacteristicIdentifier = function(characteristicIdentifier, callback) {
  this._services.forEach(function(service) {
    if (service.characteristics) {
      service.characteristics.forEach(function(characteristic) {
        if (characteristic.identifier === characteristicIdentifier) {
          callback(characteristic);
        }
      });
    }
  });
};

module.exports = PeripheralManager;
