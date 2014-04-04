richwallet.Wallet = function(walletKey, walletId) {
  this.walletKey = walletKey;
  this.walletId = walletId;
  this.defaultIterations = 1000;
  this.serverKey = undefined;
  this.transactions = [];
  this.unspent = [];
  this.minimumConfirmations = 1;
  this.unspentConfirmations = [];
  var keyPairs = [];

  this.loadPayloadWithLogin = function(id, password, payload) {
    this.createWalletKey(id, password);
    this.loadPayload(payload);
    return true;
  };

  this.loadPayload = function(encryptedJSON) {
    var payloadJSON = sjcl.decrypt(this.walletKey, encryptedJSON);
    this.payloadHash = this.computePayloadHash(payloadJSON);
    var payload = JSON.parse(payloadJSON);
    keyPairs = payload.keyPairs;
    this.transactions = payload.transactions || [];
    this.unspent = payload.unspent || [];

    for(var i=0; i<this.transactions.length; i++) {
	var tx = this.transactions[i];
	if(!tx.network) {
	    var addr = new Bitcoin.Address(tx.address);
	    tx.network = addr.getNetwork();
	}
    }

    for(var i=0; i<this.unspent.length; i++) {
	var tx = this.unspent[i];
	if(!tx.network) {
	    var addr = new Bitcoin.Address(tx.address);
	    tx.network = addr.getNetwork();
	}
    }

    return true;
  };

  this.mergePayload = function(wallet) {
    var payloadJSON = sjcl.decrypt(this.walletKey, wallet);
    var payload = JSON.parse(payloadJSON);

    keyPairs = _.uniq(_.union(payload.keyPairs, keyPairs), false, function(item, key, a) {
      return item.key;
    });

    this.transactions = _.uniq(_.union(payload.transactions, this.transactions), false, function(item, key, a) {
      return item.hash;
    });

    this.unspent = _.uniq(_.union(payload.unspent, this.unspent), false, function(item, key, a) {
      return item.hash;
    });

    this.payloadHash  = this.computePayloadHash(payloadJSON);

    return true;
  };

  this.createNewAddress = function(network, name, isChange) {
    var eckey      = new Bitcoin.ECKey();
    var newKeyPair = {
      key: eckey.getExportedPrivateKey(network),
      publicKey: Bitcoin.convert.bytesToHex(eckey.getPubKeyHash()),
      address: eckey.getBitcoinAddress(network).toString(),
      isChange: (isChange == true)
    };

    if(name)
      newKeyPair.name = name;

    keyPairs.push(newKeyPair);
    return newKeyPair.address;
  };

  this.getAddressName = function(address) {
    for(var i=0;i<keyPairs.length;i++)
      if(keyPairs[i].address == address)
        return keyPairs[i].name;
  };

  this.addresses = function(network) {
    var addrs = [];
    for(var i=0; i<keyPairs.length; i++) {
      var addr = new Bitcoin.Address(keyPairs[i].address);
      if (network != undefined && addr.getNetwork() != network) {
        continue;
      }
      addrs.push({address: addr.toString(), network: addr.getNetwork(), name: keyPairs[i].name, isChange: keyPairs[i].isChange});
    }
    return addrs;
  };

  this.receiveAddresses = function(network) {
    var addrs = [];
    for(var i=0; i<keyPairs.length; i++) {
      var addr = new Bitcoin.Address(keyPairs[i].address);
      if (network != undefined && addr.getNetwork() != network) {
          continue;
      }

      if(keyPairs[i].isChange != true)
        addrs.push({address: addr.toString(), network:addr.getNetwork(), name: keyPairs[i].name});
    }
    return addrs;
  };

  this.receiveAddressHashes = function() {
    var addrHashes = [];
    for(var i=0; i<keyPairs.length; i++) {
      if(keyPairs[i].isChange != true)
        addrHashes.push(keyPairs[i].address);
    }

    return addrHashes;
  };

  this.changeAddressHashes = function(network) {
    var addrHashes = [];
    for(var i=0; i<keyPairs.length; i++) { 
      if(keyPairs[i].isChange == true) {
	var addr = new Bitcoin.Address(keyPairs[i].address);
	if(!network || addr.getNetwork() == network) {
            addrHashes.push(keyPairs[i].address);
	}
      }
    }
    return addrHashes;
  };

  this.addressHashes = function(network) {
    var addresses = this.addresses(network);
    var addressHashes = [];
    for(var i=0;i<addresses.length;i++)
      addressHashes.push(addresses[i].address);
    return addressHashes;
  }

  this.createServerKey = function() {
    this.serverKey = sjcl.codec.base64.fromBits(sjcl.misc.pbkdf2(this.walletKey, this.walletId, this.defaultIterations));
    return this.serverKey;
  };

  this.createWalletKey = function(id, password) {
    this.walletKey = sjcl.codec.base64.fromBits(sjcl.misc.pbkdf2(password, id, this.defaultIterations));
    this.walletId = id;
    this.createServerKey();
    return this.walletKey;
  };

  this.computePayloadHash = function(payloadJSON) {
    return sjcl.codec.hex.fromBits(sjcl.hash.sha256.hash(payloadJSON));
  };

  this.encryptPayload = function() {
    var payload = {keyPairs: keyPairs, transactions: this.transactions, unspent: this.unspent};
    var payloadJSON = JSON.stringify(payload);
    this.newPayloadHash = this.computePayloadHash(payloadJSON);
    return sjcl.encrypt(this.walletKey, payloadJSON);
  };

  this.mergeUnspent = function(newUnspent) {
    var changed = false;
    this.unspentConfirmations = this.unspentConfirmations || {};

    for(var i=0;i<newUnspent.length;i++) {
      var match = false;

      for(var j=0;j<this.unspent.length;j++) {
        if(this.unspent[j].hash == newUnspent[i].hash) {
            match = true;
	    break;
	}
      }

      this.unspentConfirmations[newUnspent[i].hash] = newUnspent[i].confirmations;

      if(match == true)
        continue;

      changed = true;

      this.unspent.push({
	network: newUnspent[i].network,
        hash: newUnspent[i].hash,
        vout: newUnspent[i].vout,
        address: newUnspent[i].address,
        scriptPubKey: newUnspent[i].scriptPubKey,
        amount: newUnspent[i].amount
      });

      // todo: time should probably not be generated here

      var txMatch = false;

      for(var k=0;k<this.transactions.length;k++) {
        if(this.transactions[k].hash == newUnspent[i].hash)
          txMatch = true;
      }

      if(txMatch == false) {
        this.transactions.push({
	  network: newUnspent[i].network,
          hash: newUnspent[i].hash,
          type: 'receive',
          address: newUnspent[i].address,
          amount: newUnspent[i].amount,
          time: new Date().getTime()
        });
      }
    }

    return changed;
  };

   this.filterNetwork = function(arr, network, iterator) {
      for(var i=0; i<arr.length; i++) {
	  var obj = arr[i];
	  if(!network || network == obj.network) {
	      iterator.call(this, obj, i);
	  }
      }
  };

  this.getUnspent = function(network, confirmations) {
    if(!network) {
	throw 'void network ';
    }

    var confirmations = confirmations || 0;
    var unspentList = [];
    this.filterNetwork(this.unspent, network, function(unspent) {
	if(this.unspentConfirmations[unspent.hash] >= confirmations) {
	    unspentList.push(unspent);
	}
    });
    return unspentList;
  };

  this.pendingUnspentBalance = function(network) {
    var unspentList = this.getUnspent(network, 0);
    var changeAddresses = this.changeAddressHashes(network);
    var balance = new BigNumber(0);

    for(var u=0;u<unspentList.length;u++) {
      var unspent = unspentList[u];
      if(this.unspentConfirmations[unspent.hash] == 0 &&
	 _.contains(changeAddresses, unspent.address) == false)
        balance = balance.plus(unspent.amount);
    }
    return balance;
  };

  this.safeUnspentBalance = function(network) {
    var safeUnspentList = this.safeUnspent(network);
    var amount = new BigNumber(0);
    for(var i=0;i<safeUnspentList.length;i++)
      amount = amount.plus(safeUnspentList[i].amount);
    return amount;
  };

  this.balances = function() {
      var balances = [];
      for(var network in richwallet.config.networkConfigs) {
	  var conf = richwallet.config.networkConfigs[network];
	  var balance = this.safeUnspentBalance(network);
	  var pendingBalance = this.pendingUnspentBalance(network);
/*	  if (balance.eq(0) && pendingBalance.eq(0)) {
	      continue;
	  } */
	  balances.push({
	      'network': network,
	      'currency': conf['currency'],
	      'balance': balance,
	      'pendingBalance': pendingBalance
	  });
      }
      return balances;
  };

  // Safe to spend unspent txs.
  this.safeUnspent = function(network) {
    if(!network) {
	throw "network must be provide";
    }
    var unspent = this.getUnspent(network);
    var changeAddresses = this.changeAddressHashes(network);
    var safeUnspent = [];
    for(var u=0;u<unspent.length;u++) {
      if(_.contains(changeAddresses, unspent[u].address) == true || this.unspentConfirmations[unspent[u].hash] >= this.minimumConfirmations)
        safeUnspent.push(unspent[u]);
    }

    return safeUnspent;
  };

  this.receivedAmountTotal = function(network) {
    if(!network) {
	throw "network must be provide";
    }
    var addresses = this.addresses(network);
    var amount = new BigNumber(0);

    for(var a=0;a<addresses.length;a++)
      amount = amount.plus(this.addressReceivedAmount(addresses[a]));

    return amount;
  }

  this.addressReceivedAmount = function(address) {
    var amount = new BigNumber(0.00);

    for(var t=0; t<this.transactions.length;t++)
      if(this.transactions[t].address == address)
        amount = amount.plus(this.transactions[t].amount);

    return amount;
  };

  this.createTx = function(amtString, feeString, addressString, changeAddress) {
    var amt = Bitcoin.util.parseValue(amtString);

    if(amt == Bitcoin.BigInteger.ZERO)
      throw "spend amount must be greater than zero";

    if(!changeAddress)
      throw "change address was not provided";

    var fee = Bitcoin.util.parseValue(feeString || '0');
    var total = Bitcoin.BigInteger.ZERO.add(amt).add(fee);

    var address = new Bitcoin.Address(addressString);
    var sendTx = new Bitcoin.Transaction();
    var i;
console.info('07');
    var unspent = [];
    var unspentAmt = Bitcoin.BigInteger.ZERO;

    var safeUnspent = this.safeUnspent(address.getNetwork());
console.info('08', safeUnspent);
    for(i=0;i<safeUnspent.length;i++) {
      unspent.push(safeUnspent[i]);

      var amountSatoshiString = new BigNumber(safeUnspent[i].amount).times(Math.pow(10,8)).toString();

      unspentAmt = unspentAmt.add(new Bitcoin.BigInteger(amountSatoshiString));

      // If > -1, we have enough to send the requested amount
      if(unspentAmt.compareTo(total) > -1) {
        break;
      }
    }
console.info('09');
    if(unspentAmt.compareTo(total) < 0) {
      throw "you do not have enough coins to send this amount";
    }

    for(i=0;i<unspent.length;i++) {
      sendTx.addInput({hash: unspent[i].hash}, unspent[i].vout);
    }

    // The address you are sending to, and the amount:
    sendTx.addOutput(address, amt);

    var remainder = unspentAmt.subtract(total);

    if(!remainder.equals(Bitcoin.BigInteger.ZERO)) {
      sendTx.addOutput(changeAddress, remainder);
    }

    var hashType = 1; // SIGHASH_ALL
      console.info('11');

    // Here will be the beginning of your signing for loop

    for(i=0;i<unspent.length;i++) {
	console.info('unspent ', i, unspent[i]);
      var unspentOutScript = new Bitcoin.Script(Bitcoin.convert.hexToBytes(unspent[i].scriptPubKey));
      var hash = sendTx.hashTransactionForSignature(unspentOutScript, i, hashType);
      var pubKeyHash = unspentOutScript.simpleOutHash();
      var pubKeyHashHex = Bitcoin.convert.bytesToHex(pubKeyHash);
	console.info('12');
      for(var j=0;j<keyPairs.length;j++) {
        if(_.isEqual(keyPairs[j].publicKey, pubKeyHashHex)) {
          var key = new Bitcoin.Key(keyPairs[j].key);
          var signature = key.sign(hash);
          signature.push(parseInt(hashType, 10));

          sendTx.ins[i].script = Bitcoin.Script.createInputScript(signature, key.getPub());
          break;
        }
      }
    }
      console.info('13');
    return {unspentsUsed: unspent, obj: sendTx, raw: Bitcoin.convert.bytesToHex(sendTx.serialize())};
  };

  this.calculateFee = function(amtString, addressString, changeAddress) {
    var tx = this.createTx(amtString, 0, addressString, changeAddress);
    console.info('createTx', amtString, 0, addressString, changeAddress, 'as', tx.raw);
    var addr = new Bitcoin.Address(addressString);
    var txSize = tx.raw.length / 2;
    var fee = Math.ceil(txSize/1000)*addr.networkConfig().fee;
    return fee;    
  };

  this.addTx = function (tx, amtString, feeString, addressString, changeAddress) {
    this.transactions.push({
      network: new Bitcoin.Address(addressString).getNetwork(),
      hash: Bitcoin.convert.bytesToHex(tx.obj.getHash()),
      type: 'send',
      address: addressString,
      amount: amtString,
      fee: feeString,
      time: new Date().getTime()
    });

    // Remove unspent elements now that we have a tx that uses them
    for(var i=0;i<tx.unspentsUsed.length;i++)
      this.unspent = _.reject(this.unspentsUsed, function(u) { return u.hash == tx.unspentsUsed[i].hash })
  };

  if(walletKey && walletId)
    this.createServerKey();
};
