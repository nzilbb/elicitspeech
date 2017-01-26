
var uploads = {};
var uploadQueue = [];
var settings = null;
var directory = null;
var retryFrequency = 30000;
var timeout = null;
var httpAuthorization = null;

function getParticipantId(seriesDirectory) {
	Ti.API.log("uploader: getParticipantId: " + seriesDirectory.name);
	// is the participant file set in participant.json?
	var participantFile = Ti.Filesystem.getFile(seriesDirectory.nativePath, "participant.json");
	var blob = participantFile.read();
	if (blob != null) {
		var participantAttributes = JSON.parse(blob.text);
		if (participantAttributes.id) {
			// we already have an ID, so return it
			return participantAttributes.id;
		} else { // try to generate an ID
			var xhr = Titanium.Network.createHTTPClient();
			xhr.onload = function(e) {
			   	var data = JSON.parse(this.responseText);
			   	participantAttributes.id = data.model.name;
			   	
		    	Ti.API.info("uploader: participant ID "+participantAttributes.id);
				participantFile.write(JSON.stringify(participantAttributes));
				
				exports.prod();
			};
			xhr.onerror = function(e) {
			   	Ti.API.debug("Uploader: Could not generate participant ID: " + e.error);
			};
			Ti.API.info('uploader: requesting new participant ID...');
			xhr.open("POST", settings.newParticipantUrl);
			if (httpAuthorization) xhr.setRequestHeader("Authorization", httpAuthorization);
			xhr.send(participantAttributes);			
		} // try to generate an ID		
	}
	return null;
}

function doNextUpload() {
	timeout = null;
	scanForUploads();
	Ti.API.log("uploader: doNextUpload " + uploadQueue.length);
	if (uploadQueue.length > 0) {
		var upload = uploadQueue[uploadQueue.length-1];
		Ti.API.log("uploader: " + upload.transcriptName);
		
		var participantId = getParticipantId(upload.seriesDirectory);
		if (participantId) {
			// upload files
			Ti.API.info('uploader: uploadFile '+upload.transcriptFile.name);
			var series = participantId + "-" + upload.seriesDirectory.name;
			var sUploadedName = participantId + "-" + upload.transcriptName;
			Ti.API.info('uploader: name '+sUploadedName+'');
			
			// create form data
			var text = upload.transcriptFile.read().text;
			var transcriptFileIncludingParticipant = Ti.Filesystem.getFile(Ti.Filesystem.getTempDirectory(), sUploadedName);
			// insert the participant ID after the meta data and before the starting comment
			transcriptFileIncludingParticipant.write(text.replace(/{/, participantId + ": {"));
			upload.transcriptFileIncludingParticipant = transcriptFileIncludingParticipant;
			upload.form = {
				"content-type" : "application/json",
				num_transcripts : 1,
				todo : "upload",
				auto : "true",
				transcript_type : settings.transcriptType,
				corpus : settings.corpus,
				family_name : series,
				uploadfile1_0 : transcriptFileIncludingParticipant,
			    uploadmedia1: upload.mediaFile
			  };
			if (upload.docFile && upload.docFile.exists()) {
				Ti.API.info('uploader: doc '+upload.docFile.name);
				upload.form.doc = upload.docFile;
			}
		
			Ti.API.log("uploader: post " + settings.uploadUrl);
			upload.percentComplete = 1;
			upload.status = "uploading...";
			exports.uploadProgress(uploads);
			
		    upload.request = Titanium.Network.createHTTPClient({
		    	onload: function(e) {
		    		Ti.API.log("uploader: onload");
					var transcriptName = e.source.transcriptName;
				    var verifyRequest = Titanium.Network.createHTTPClient({
				    	onload: function(e) {
				    		try {
							   	var data = JSON.parse(this.responseText);
							   	if (data.model.ag_id) {	
									Ti.API.log('uploader: verified: ag_id=' + data.model.ag_id);
									var transcriptName = e.source.transcriptName;
									upload = uploads[transcriptName]; 
									upload.percentComplete = 100;
									upload.status = "complete";
									exports.uploadProgress(uploads);
									// remove it from the queue
									uploadQueue.pop();
									// and delete the files
									upload.transcriptFile.deleteFile();
									upload.form.uploadfile1_0.deleteFile();
									upload.form.uploadmedia1.deleteFile();
									if (upload.form.doc) {
										upload.form.doc.deleteFile();
									}
									
									// start next one, if any
									timeout = setTimeout(doNextUpload, 50);
								} else {
									Ti.API.log('uploader: not verified: ' + data.errors[0]);
									var transcriptName = e.source.transcriptName;
									uploads[transcriptName].status = "verification failed";
									exports.uploadProgress(uploads, (e.error||"Could not upload.") + " Will try again...");
									timeout = setTimeout(doNextUpload, retryFrequency);
								}
							} catch (x) {
								Ti.API.log('uploader: invalid verify response: ' + x);
								Ti.API.log(this.responseText);
								var transcriptName = e.source.transcriptName;
								uploads[transcriptName].status = "verification failed";
								exports.uploadProgress(uploads, (e.error||"Could not upload.") + " Will try again...");
								timeout = setTimeout(doNextUpload, retryFrequency);
							}	    		
				    	},
				    	onerror : function(e) {
							Ti.API.log('uploader: verify: ' + e.error);
							Ti.API.log(this.responseText);
							var transcriptName = e.source.transcriptName;
							uploads[transcriptName].status = "verification failed";
							exports.uploadProgress(uploads, (e.error||"Could not upload.") + " Will try again...");
							timeout = setTimeout(doNextUpload, retryFrequency);
				    	}
				    });
				    verifyRequest.transcriptName = transcriptName;
					verifyRequest.open('GET', settings.verifyUrl + "?transcript_id=" + sUploadedName);
					if (httpAuthorization) verifyRequest.setRequestHeader("Authorization", httpAuthorization);
					Ti.API.log("uploaser: verifying " + sUploadedName);
					verifyRequest.send();			
		    	},
		    	onerror : function(e) {
					Ti.API.log('uploader: ' + e.error);
					Ti.API.log(this.responseText);
					var transcriptName = e.source.transcriptName;
					uploads[transcriptName].status = "failed";
					exports.uploadProgress(uploads, (e.error||"Could not upload.") + " Will try again...");
					timeout = setTimeout(doNextUpload, retryFrequency);
			    },
			    onsendstream: function(e) {
					//Ti.API.log('uploader: progress...' + e.progress);
					var transcriptName = e.source.transcriptName;
					uploads[transcriptName].percentComplete = e.progress * 100;
					uploads[transcriptName].status = "uploading...";
					exports.uploadProgress(uploads);
			    }
		    });
		    upload.request.transcriptName = upload.transcriptName;
			upload.request.open('POST', settings.uploadUrl);
			if (httpAuthorization) upload.request.setRequestHeader("Authorization", httpAuthorization);
			upload.request.send(upload.form);
				
			Ti.API.log("uploader: request sent");

		} else {
			// no participantId means that we're not online yet, so wait until we are
			Ti.API.log("uploader: Could not get participantId for " + upload.transcriptName + " - will retry...");
			timeout = setTimeout(doNextUpload, retryFrequency);
		}
	} else {
		// nothing in the queue, so wait a minute and try again
		Ti.API.log("uploader: nothing in the queue - waiting...");
		timeout = setTimeout(doNextUpload, retryFrequency);
	}
}

// checks the filesystem for previously unseen transcripts
function scanForUploads() {
	var report = "";
	Ti.API.log("uploader: Scanning for transcripts");
	report += "\nuploader: Scanning for transcripts";
	// each subdirectory is a series
	var files = Ti.Filesystem.getFile(directory).getDirectoryListing();
	for (f in files) {
		var file = Ti.Filesystem.getFile(directory, files[f]);
		if (file.isDirectory()) { // series
			// check participant file exists
			if (!Ti.Filesystem.getFile(directory, files[f], "participant.json").exists()) {
				Ti.API.log("uploader: skipping " + files[f] + " - there's no participant file");
				report += "\nuploader: skipping " + files[f] + " - there's no participant file";
				//file.deleteDirectory(true);
			} else {
				// get files in the series directory
				var seriesFiles = file.getDirectoryListing();
				var doc = null;
				// look for html or pdf files, which are consent forms
				for (t in seriesFiles) {
					var fileName = seriesFiles[t];
					if (fileName.match(/\.html$/) || fileName.match(/\.pdf$/)) {
						Ti.API.log("uploader: found doc " + fileName);
						report += "\nuploader: found doc " + fileName;
						doc = Ti.Filesystem.getFile(directory, files[f], fileName);
					}
				} // next file
				// look for txt files, which are transcripts
				var foundTranscripts = false;
				for (t in seriesFiles) {
					var fileName = seriesFiles[t];
					if (fileName.match(/\.txt$/) && !uploads[fileName]) {
						Ti.API.log("uploader: found " + fileName);
						report += "\nuploader: found " + fileName;
						var fTranscript = Ti.Filesystem.getFile(directory, files[f], fileName);
						var fAudio = Ti.Filesystem.getFile(directory, files[f], fileName.replace(/txt$/,"wav"));
						if (!fAudio.exists()) {
							// no wav file, so forget this upload
							Ti.API.log("uploader: deleting " + fileName + " - no associated recording");
							report += "\nuploader: deleting " + fileName + " - no associated recording";
							fTranscript.deleteFile();
						} else {
							foundTranscripts = true;
							var upload = {
								transcriptName: fileName,
								transcriptFile: fTranscript,
								mediaFile: fAudio,
								seriesDirectory: Ti.Filesystem.getFile(directory, files[f]),
								status: "waiting...",
								percentComplete: 0
								};
							if (doc) {
								upload.docFile = doc;
								doc = null;
							}
							uploads[fileName] = upload;
							uploadQueue.unshift(upload);
						} // wav file exists
					} // previously unknown transcript
				} // next possible transcript
				if (!foundTranscripts) {
					//Ti.API.log("No transcripts in " + files[f]);
					report += "\nNo transcripts in " + files[f];
					//file.deleteDirectory(true);
				}
			} // there is a participant.json file
		} // is directory
	} // next file
	/*
	rrequest = Titanium.Network.createHTTPClient({
    	onload: function(e) {
    		Ti.API.log("uploader: report done");
			Ti.API.log(this.responseText);
    	},
    	onerror : function(e) {
			Ti.API.log('uploader: report: ' + e.error);
			Ti.API.log(this.responseText);
	    }
    });
    Ti.API.log("sending report: " + report);
	rrequest.open('POST', "http://robert.fromont.net.nz/system/report");
	rrequest.send({ report : report });
	*/
}

// callback for upload progress updates	
exports.uploadProgress = function(uploads, message) {};

// wake the uploader up if it's asleep
exports.prod = function(transcriptName, fd) {
	if (timeout) {
		clearTimeout(timeout);
		timeout = setTimeout(doNextUpload, 50);
	}
};

// initialise the uploader
exports.initialise = function(settingsFromInitialiser, workingDirectory, progressCallback, httpAuth) {
	exports.initialised = true;
	httpAuthorization = httpAuth;
	exports.uploadProgress = progressCallback;
	settings = settingsFromInitialiser;
	directory = workingDirectory;
	Ti.API.log("uploader: " + directory);
	Ti.Network.addEventListener('change', function(e) {
  		if (e.online) {
  			// wake the uploader up again as soon as we come online
  			exports.prod();
  		}
	});
	doNextUpload();
};

exports.initialised = false;