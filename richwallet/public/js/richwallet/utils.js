richwallet.utils = {};

// https://github.com/component/escape-html
richwallet.utils.stripTags = function(html) {
  return String(html)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

richwallet.utils.callRPC = function(network, command, args, callback) {
    $.ajax({
	url: '/api/proxy/' + network + '/' + command,
	data: JSON.stringify({args: args}),
	contentType: 'application/json',
	dataType: 'json',
	success: function(resp) {
	    if(callback) {
		var err = resp.error;
		var data = resp.result;
		callback(err, data);
	    }
	},
	type: 'POST',
	processData: false
    });
};
