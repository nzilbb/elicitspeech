
var uploads = {};
var uploadQueue = [];

function doNextUpload() {
	Ti.API.log("doNextUpload " + uploadQueue.length);
	if (uploadQueue.length > 0) {
		Ti.API.log("upload " + uploadQueue[uploadQueue.length-1]);
		var upload = uploadQueue[uploadQueue.length-1];
		Ti.API.log("post " + exports.uploadUrl);
		uploads[upload.transcriptName].percentComplete = 1;
		uploads[upload.transcriptName].status = "uploading...";
		exports.uploadProgress(uploads);
	    upload.request = Titanium.Network.createHTTPClient({
	    	onload: function(e) {
	    		Ti.API.log("onload");
				var transcriptName = e.source.transcriptName;
				uploads[transcriptName].percentComplete = 100;
				uploads[transcriptName].status = "complete";
				exports.uploadProgress(uploads);
				// remove it from the queue
				uploadQueue.pop();
				// start next one, if any
				//doNextUpload();
				setTimeout(doNextUpload, 50);	    		
	    	},
	    	onerror : function(e) {
				Ti.API.log('UPLOAD ERROR ' + e.error);
				Ti.API.log(this.responseText);
				var transcriptName = e.source.transcriptName;
				uploads[transcriptName].status = "failed";
				exports.uploadProgress(uploads, (e.error||"Could not upload.") + " Will try again...");
				// try again in one minute
				//doNextUpload();
				setTimeout(doNextUpload, 60000);
		    },
		    onsendstream: function(e) {
				//	$.pbUpload.value = e.progress ;
				var transcriptName = e.source.transcriptName;
				uploads[transcriptName].percentComplete = e.progress;
				uploads[transcriptName].status = "uploading...";
				exports.uploadProgress(uploads);
		    }
	    });
	    upload.request.transcriptName = upload.transcriptName;
		upload.request.open('POST', exports.uploadUrl);
		upload.request.send(upload.form);
			
		Ti.API.log("finished doNextUpload");
	}
}
	
exports.uploadUrl = "";
exports.uploadProgress = function(uploads, message) {};
exports.initialise = function(url, progressCallback) {
	exports.uploadUrl = url;
	exports.uploadProgress = progressCallback;
};
exports.enqueueUpload = function(transcriptName, fd) {
	uploads[transcriptName] = { percentComplete: 0, status: "waiting..."};
	var upload = { transcriptName: transcriptName, form: fd };
	uploadQueue.unshift(upload);
	if (uploadQueue.length == 1) {
		doNextUpload();
	}
};
