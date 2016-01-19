var settings = null;
var taskName = "es";
//var startUrl = "http://192.168.1.140:8080/labbcat/elicit/steps?content-type=application/json&task="+taskName;
var startUrl = "https://labbcat.canterbury.ac.nz/test/elicit/steps?content-type=application/json&task="+taskName;
var steps = [
	{
		prompt: "<p>Unfortunately, the task steps are not currently accessible. Please check you are connected to the internet.</p>",
		record: false
	}
];

// series-specific variables
var series = null;
var participantId = null;
var recIndex = 0;
var consentShown = false;
var signature = null;
var consentPdf = null;
var consentSent = false;
var participantFormControls = {};
var currentStep = -1;

var recorder = null;
var audioFile = null;

var countdownTimer = null;
var countdownCall = null;
var countdownStart = null;
var countdownEnd = null;
var countdownDisplay = false;
function startTimer(durationSeconds, whatToDo, display) {
	killTimer();
	countdownCall = whatToDo;
	countdownStart = new Date().getTime();
	countdownEnd = countdownStart + 1000 * durationSeconds;
	countdownTimer = setInterval(timerTick, 50);
	countdownDisplay = display;
}
function killTimer() {
	if (countdownTimer) clearInterval(countdownTimer);
	countdownTimer = null;
	countdownStart = null;
	countdownEnd = null;
}
function timerTick() {
	var now = new Date().getTime();
	if (countdownDisplay) {
		var secondsLeft = ""+(Math.floor((countdownEnd - now) / 1000) + 1);
		$.lblPrompt.text = noTags(settings.resources.countdownMessage) + "\n" + secondsLeft;
	}	
	if (now >= countdownEnd) {
		killTimer();
		countdownCall();
	}
}

function generateConsentPdf(sig) {
	signature = sig;
	// get signed consent as PDF
	var url = settings.consentUrl+"?content-type=application/pdf&task="+taskName+"&signature="+signature;
	Ti.API.log(url);
	var client = Ti.Network.createHTTPClient();
	client.onload = function(e) {
				Ti.API.log("Got PDF");
				consentPdf = this.file;
				// TODO getNewParticipantId() instead of ...
				// create participant form
				createParticipantForm();				
		};
	client.onerror = function(e) {
				Ti.API.debug(e.error);
				alert('Error getting signed consent as PDF: ' + e.error);
		};
	// Prepare the connection.
	client.open("GET", url);
	client.file = Ti.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), taskName + "-consent.pdf");
	// Send the request.
	client.send();				

}
function getNewParticipantId(attributes) {
	var xhr = Titanium.Network.createHTTPClient();
	xhr.onload = function(e) {
		$.index.open();
	   	var data = JSON.parse(this.responseText);
	   	participantId = data.model.name;
	   	var now = new Date();
    	series = participantId + "-"+now.toISOString().substring(0,16).replace(/[-:]/g,"").replace("T","-");
    	Ti.API.info("series "+series);
		// TODO start uploading files instead of ... 
		startNextStep();
	};
	xhr.onerror = function(e) {
	   	Ti.API.debug("STATUS: " + this.status);
	   	Ti.API.debug("TEXT:   " + this.responseText);
	   	Ti.API.debug("ERROR:  " + e.error);
	   	alert('There was an error generating a participant ID. Try again.');
	   	getNewParticipantId(attributes);
	};
	Ti.API.info('getting new participant ID...');
	xhr.open("POST", settings.newParticipantUrl);
	xhr.send(attributes);
}

function startSeriesUpload(sessionName) {
	// session directory
	
	// load attributes.json
	
	// if participantId unset create new participant ID 
	
	// load participant ID
}

var uploads = {};
var uploadQueue = [];
// progress of all uploads
function uploadsProgress() {
	// if we're actually displaying progress
	if (currentStep >= steps.length - 1) {
		var transcriptCount = 0;
		var percentComplete = 0;
		for (transcriptName in uploads) {
			transcriptCount++;
			percentComplete += uploads[transcriptName].percentComplete; 
		} // next upload
		if (transcriptCount > 0) {
			$.pbOverall.max = 100;
			$.pbOverall.value = percentComplete / transcriptCount;
			if ($.pbOverall.value == $.pbOverall.max) {
				$.lblUpload.text = noTags(settings.resources.uploadFinished);
			} else {
				$.lblUpload.text = noTags(settings.resources.uploadingPleaseWait);
			}
		}
	}
}
// progress of current upload
function uploadProgress(evt) {
	//	$.pbUpload.value = e.progress ;
	var transcriptName = evt.source.transcriptName;
	uploads[transcriptName].percentComplete = evt.progress;
	uploads[transcriptName].status = "uploading...";
	uploadsProgress();
}
// current upload finished
function uploadComplete(evt) {
	var transcriptName = evt.source.transcriptName;
	uploads[transcriptName].percentComplete = 100;
	uploads[transcriptName].status = "complete";
	uploadsProgress();
	// remove it from the queue
	uploadQueue.pop();
	// start next one, if any
	doNextUpload();
}
// error with current upload
function uploadError(evt) {
	Ti.API.info('UPLOAD ERROR ' + evt.error);
	Ti.API.info(this.responseText);
	var transcriptName = evt.source.transcriptName;
	uploads[transcriptName].status = "failed";
	uploadsProgress();
	// try again
	doNextUpload();
}
// create an upload request for the audio file
function uploadFile(file) {
	Ti.API.info('uploadFile('+file.name+')');
	var xhr = Titanium.Network.createHTTPClient();
	xhr.onload = uploadComplete;
	xhr.onerror = uploadError;	
	xhr.onsendstream = uploadProgress;
	//xhr.setRequestHeader('Content-Type', 'multipart/form-data');
	var sName = series + "-" + (++recIndex);
	Ti.API.info('name '+sName+')');
	xhr.transcriptName = sName + ".txt";
	uploads[xhr.transcriptName] = { percentComplete: 0, status: "waiting..."};
	var fTranscript = Ti.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), xhr.transcriptName);
	fTranscript.write(participantId + ": {" + steps[currentStep].prompt + "} " + steps[currentStep].transcript);
	var formData = {
		"content-type" : "application/json",
		num_transcripts : 1,
		todo : "upload",
		auto : "true",
		transcript_type : settings.transcriptType,
		corpus : settings.corpus,
		family_name : series,
		uploadfile1_0 : fTranscript,
	    uploadmedia1: file,
	    doc : (consentPdf && !consentSent)?consentPdf:null
	  };
	consentSent = true;
	enqueueUpload(xhr, formData);
	uploadsProgress();
}
function enqueueUpload(xhr, fd) {
	var upload = { request: xhr, form: fd };
	uploadQueue.unshift(upload);
	if (uploadQueue.length == 1) {
		doNextUpload();
	}
}
function doNextUpload() {
	if (uploadQueue.length > 0) {
		var upload = uploadQueue[uploadQueue.length-1];
		upload.request.open('POST', settings.uploadUrl);
		upload.request.send(upload.form);
	}
}

function onNext(e)
{
	if ($.btnNext.title == "Start Again") { // TODO i18n
		$.btnNext.title = noTags(settings.resources.next);
		startSession();
		return;
	}
	Ti.API.info('Next...');
	if (!signature) {
		if (settings.consent && consentShown) {
			if ($.txtSignature.value == "") {
				$.txtSignature.focus();
				alert(noTags(settings.resources.pleaseEnterYourNameToIndicateYourConsent));
			} else {
				// TODO defer PDF or generate offline
				//createParticipantForm();
				generateConsentPdf($.txtSignature.value);
			}
		} else {
			showConsent(); 
		}
	} else if (!participantId) { // don't have a participant ID yet
		newParticipant();
	} else {
		// hide the button to stop double-clicks
		$.btnNext.hide();
	
		finishLastStep(); // which will automatically start the next step
	}
}

// starting point for an elicitation session
function startSession() {
	// ensure any previous participants are forgotten
	series = null;
	participantId = null;
    recIndex = 0;
    consentShown = false;
    signature = null;
    consentPdf = null;
    consentSent = false;
    participantFormControls = {};
    currentStep = -1;
    
    // resent UI components
    $.txtSignature.value = "";
	$.pbOverall.max = steps.length;
	$.pbOverall.value = 0;
	$.pbOverall.message = noTags(settings.resources.overallProgess);
	$.lblUpload.text = "";
	$.lblTitle.text = "";
	$.lblPrompt.text = "";
	$.lblTranscript.text = "";	
    
	// start user interface...
	showPreamble();
}

function showPreamble() {
	if (settings.preamble) {
		$.htmlPreamble.html = settings.preamble;
		$.htmlPreamble.show();
		$.consent.hide();
	} else {
		showConsent();
	}
}

function showConsent() {
	$.htmlPreamble.hide();
	if (settings.consent) {		
		$.htmlConsent.html = settings.consent;
		consentShown = true;
		$.consent.show();
		$.txtSignature.focus();
	} else {
		signature = " ";
		createParticipantForm();
	}
}

function createParticipantForm()
{
	$.htmlPreamble.hide();
	$.consent.hide();
	if (settings.participantFields.length == 0)
	{
		$.participantForm.hide();	
		$.participantForm.visible = false;
		newParticipant();
	}
	else
	{	
		$.lblTitle.text = noTags(settings.resources.participantInfoPrompt);
	
		// a 'slot' is a row position on the form - one for label, one for control, except some which occupy more slots
		var slotCount = 0;
		var tallControlSlots = 3;
		for (f in settings.participantFields)
		{
			slotCount++; // one slot for label
			var field = settings.participantFields[f];
			if (field.type == "select")
			{
				slotCount += field.options.length;
			}
			else if (field.type == "date"
			|| field.type == "datetime"
			|| field.type == "time"
			|| field.type == "text")
			{
				slotCount += tallControlSlots; // tall control
			}		
			else
			{
				slotCount++; // one-slot control
			}
		}
		var slotHeightPercentage = 100 / slotCount;
		var slot = 0; 
		for (f in settings.participantFields)
	    {
			var field = settings.participantFields[f];
			var label = Ti.UI.createLabel({ 
				text : field.label,
				color: "#000000",
				font: { fontSize: 20 },
				verticalAlign: Titanium.UI.TEXT_VERTICAL_ALIGNMENT_CENTER,
				top: String(slot*slotHeightPercentage) + "%", 
				width: "90%",
				height: String(slotHeightPercentage) + "%"});
			slot++;
			$.participantForm.add(label);
			var value = null;
			if (field.type == "select")
			{
				checkbox_on = function() {
				    this.backgroundColor = '#FFFFFF';
				    this.color = '#000000';
					this.font = {fontSize: 25, fontWeight: 'bold'};
				    this.selected = true;
				    Ti.API.info("Selecting " + this.value);
				    for (o in this.field.options)
				    {
				    	var option = this.field.options[o];
				    	if (option.value != this.value) option.checkbox.off();
				    }
				};
				
				checkbox_off = function() {
				    this.backgroundColor = '#aaa';
				    this.color = '#FFFFFF';
				    this.selected = false;
					this.font = {fontSize: 25};
				};
				
				checkbox_onClick = function(e) {
					Ti.API.info("click " + e.source.title);
				    if(false==e.source.selected) {
				        e.source.on();
				    } else {
				        e.source.off();
				    }
				};
				for (o in field.options)
				{
					var option = field.options[o]; 
					var checkbox = Ti.UI.createButton({
					    title: option.description,
					    borderColor: '#666',
					    borderWidth: 2,
					    borderRadius: 3,
					    backgroundColor: '#aaa',
					    backgroundImage: 'none',
					    color: '#fff',
					    font:{fontSize: 25, fontWeight: 'bold'},
					    selected: false,
					    value: option.value,
					    field: field,
	  					top: String(slot*slotHeightPercentage)+"%", 
						width: "90%"/*,
						height: String(slotHeightPercentage) + "%"*/});
					
					option.checkbox = checkbox;					
					
					//Attach some simple on/off actions
					checkbox.on = checkbox_on;					
					checkbox.off = checkbox_off;					
					checkbox.addEventListener('click', checkbox_onClick);
					
					$.participantForm.add(checkbox);
					slot++;
				}
				field.getValue = function() {
					Ti.API.info("getting value for " + this.label);
					for (o in this.options)
					{
						var option = this.options[o];
						Ti.API.info("option " + option.value + " - "+ option.checkbox.selected);
						if (option.checkbox.selected) 
						{
							
							return option.value;
						}
					}
					return null;
				};
			}
			else if (field.type == "date")
			{
				value = Ti.UI.createPicker({
					color: "#000000",
					type: Ti.UI.PICKER_TYPE_DATE,
					useSpinner:false,
	  				top: String(slot*slotHeightPercentage)+"%", 
					width: "90%",
					height: String(slotHeightPercentage*tallControlSlots) + "%"});
				field.getValue = function() { return this.control.value; };
				slot+=tallControlSlots; 
			}
			else if (field.type == "datetime")
			{
				value = Ti.UI.createPicker({
					color: "#000000",
					type: Ti.UI.PICKER_TYPE_DATE_AND_TIME,
					useSpinner:false,
	  				top: String(slot*slotHeightPercentage)+"%", 
					width: "90%",
					height: String(slotHeightPercentage*tallControlSlots) + "%"});
				field.getValue = function() { return this.control.value; };
				slot+=tallControlSlots; 
			}
			else if (field.type == "time")
			{
				value = Ti.UI.createPicker({
					color: "#000000",
					type: Ti.UI.PICKER_TYPE_TIME,
					useSpinner:false,
	  				top: String(slot*slotHeightPercentage)+"%", 
					width: "90%",
					height: String(slotHeightPercentage*tallControlSlots) + "%"});
				field.getValue = function() { return this.control.value; };
				slot+=tallControlSlots;
			}
			else if (field.type == "boolean")
			{
				value = Ti.UI.createSwitch({
					color: "#000000",
					borderWidth: 2,
  					borderColor: '#bbb',
  					borderRadius: 5,
					value: false,
					title: field.description,
	  				top: String(slot*slotHeightPercentage)+"%", 
					width: "90%",
					height: String(slotHeightPercentage) + "%"});
				try
				{
					value.style = Ti.UI.Android.SWITCH_STYLE_CHECKBOX;
				}
				catch (x)
				{}
				field.getValue = function() { return this.control.value; };
				slot++;			
			}
			else if (field.type == "text")
			{
				value = Ti.UI.createTextArea({
					color: "#000000",
					borderWidth: 2,
  					borderColor: '#bbb',
  					borderRadius: 5,
	  				top: String(slot*slotHeightPercentage)+"%", 
					width: "90%",
					height: String(slotHeightPercentage*tallControlSlots) + "%"});
				field.getValue = function() { return this.control.value; };
				slot+=tallControlSlots;
			}
			else
			{
				value = Ti.UI.createTextField({
					borderStyle: Ti.UI.INPUT_BORDERSTYLE_ROUNDED,
					borderWidth: 2,
  					borderColor: '#bbb',
  					borderRadius: 5,
					color: "#000000",
	  				top: String(slot*slotHeightPercentage)+"%", 
					width: "90%",
					/*height: String(slotHeightPercentage) + "%"*/});
				Ti.API.info("createing control for for " + field.label);
				field.getValue = function() { 					
					Ti.API.info("getting value for " + this.label);
					return this.control.value; };
				slot++;
			}
			if (value) {
				field.control = value;
				$.participantForm.add(value);
			}
		} // next field
		$.participantForm.opacity = 1.0;
		$.participantForm.visible = true;
	}	
}

function newParticipant()
{
	Ti.API.info("newParticipant " + $.participantForm.visible);
	var attributes = {};
	if ($.participantForm.visible)
	{ // validate form
		Ti.API.info("validating...");
		for (f in settings.participantFields)
	    {
			var field = settings.participantFields[f];
			var value = field.getValue();
			Ti.API.info(field.attribute + " = " + value);
			if (!value)
			{
				Ti.API.info(" no value for " + field.attribute);
				alert(noTags(settings.resources.pleaseSupplyAValueFor) + " " + field.label);
				return;
			}
			else if (field.type == "number")
			{
				if (isNaN(value))
				{
					alert(noTags(settings.resources.pleaseSupplyANumberFor) + " " + field.label);
					return;
				}
			}
			else if (field.type == "integer")
			{
				if (isNaN(value))
				{
					alert(noTags(settings.resources.pleaseSupplyANumberFor) + " " + field.label);
					return;
				}
				else
				{
					value = parseInt(value);
				}
			}
			attributes[field.attribute] = value;
		} // next field
		$.participantForm.hide();	
		$.participantForm.visible = false;
	}
	
	if (!$.participantForm.visible)
	{
	    attributes["newSpeakerName"] = taskName+"-{0}";
		attributes["content-type"] = "application/json";

		// TODO defer creation of participant
		getNewParticipantId(attributes); 
		//startNextStep();
	}
}

function startNextStep() {
	Ti.API.info('startNextStep() - last: ' + currentStep);
	currentStep++;
	$.pbOverall.value++; 
	if (currentStep < steps.length)
	{
	    if (currentStep < steps.length - 1) 
		{ // not last step
			if (steps[currentStep].countdown_seconds > 0) {
				Ti.API.info('Waiting for '+steps[currentStep].countdown_seconds);
				clearPrompts();
				Ti.API.log("countdown - hiding next button");
				startTimer(steps[currentStep].countdown_seconds, showCurrentPhrase, true);
			} else {
				showCurrentPhrase();
			}
			if (steps[currentStep].record) {
				startRecording();
			}
		}
	    else
	    { // display participant ID etc.
			showCurrentPhrase();
	    	finished();
	    }		
	}
	else // finished all steps
	{
		Ti.API.info('No more steps');
		$.lblPrompt.text = "";
		$.lblTranscript.text = "";
		finished();	
	}
}

function showCurrentPhrase() {
    // set texts	     	
    if (steps[currentStep].title)
    {
		$.lblTitle.text = steps[currentStep].title;
	}
	else 
	{
		$.lblTitle.text = "";
	}
    if (steps[currentStep].prompt)
    {
		$.lblPrompt.text = steps[currentStep].prompt;
	}
	else 
	{
		$.lblPrompt.text = "";
	}
	if (steps[currentStep].transcript)
	{
		$.lblTranscript.text = "\""+steps[currentStep].transcript+"\"";
	}
	else
	{
		$.lblTranscript.text = "";
	}

	// ensure size of transcript is appropriate for content length
	if ($.lblTranscript.text.length > 150)
	{ // reading passage
		$.lblTranscript.font = { fontFamily: $.lblTranscript.font.name, fontSize: 20} ;
		Ti.API.info("Font size: " + $.lblTranscript.font.fontSize);
		$.lblTranscript.textAlign = "left";
	}
	else
	{ // short prompt
		$.lblTranscript.font = { fontFamily: $.lblTranscript.font.name, fontSize: 32} ;
		$.lblTranscript.textAlign = "center";
	}
	
	// rearrange UI depending on texts
	if (steps[currentStep].prompt && !steps[currentStep].transcript
		&& !steps[currentStep].image) // e.g. map task
	{
		$.lblPrompt.height = "70%";
		$.lblPrompt.show();
		$.lblTranscript.hide();
	}
	else if (steps[currentStep].transcript && ! steps[currentStep].prompt) // e.g. reading task
	{
		$.lblPrompt.hide();
		$.lblTranscript.top = "5%";
		$.lblTranscript.height = "70%";
		$.lblTranscript.show();
	}
	else // both prompt and transcript are set
	{
		$.lblPrompt.height = "35%"; // TODO make this adaptive to the sizes of each
		$.lblPrompt.show();
		$.lblTranscript.top = "40%";
		$.lblTranscript.height = "35%";
		$.lblTranscript.show();
	}
	
	// is there an image?
	if (steps[currentStep].image)
	{
		$.image.image = settings.imageBaseUrl + steps[currentStep].image; 
	}
	else
	{
		$.image.image = null;
	}
	if (currentStep < steps.length - 1 && steps[currentStep].record) {
		// reveal we are recording	
    	$.aiRecording.show();
    	// and make sure they don't go over the max time
    	startTimer(steps[currentStep].max_seconds, finishLastStep);
    } 	
    if (currentStep < steps.length - 1)
    { // show next button only if there's a next step 
    	Ti.API.log("showing next button in a sec...");
		setTimeout(function() { Ti.API.log("showing next button"); $.btnNext.show(); }, 1000); 
	
    	//$.btnNext.show();
    }
}
function clearPrompts() {
	$.lblTitle.text = "";
	$.lblPrompt.text = noTags(settings.resources.countdownMessage)+"\n";
	$.lblTranscript.text = "";	
}

function finished()
{
	$.lblPrompt.text += "\n\n"+noTags(settings.resources.yourParticipantIdIs)+"\n"+participantId;	    	
    Ti.API.log("finished - hiding next button");
    $.aiRecording.hide();
    
	$.btnNext.title = "Start Again"; // TODO i18n
    $.btnNext.show();
    
    // TODO open consent PDF 	
}

function finishLastStep()
{
	Ti.API.info('finishLastStep()');
	if (recorder && recorder.getRecording()) {
		stopRecording();
		if (audioFile) {
			uploadFile(audioFile); // next step will start when upload is done
		}
	}
	startNextStep();
}

function startRecording()
{
	Ti.API.info('startRecording()');
	if ($.pbOverall.value >= $.pbOverall.max)
	{ // don't record the last step, there's no next button to stop recording
		Ti.API.error('startRecording() but on last step - recording not started because it would never be stopped');
		return;
	}
	
	try
	{
		Titanium.Media.audioSessionMode = Ti.Media.AUDIO_SESSION_MODE_PLAY_AND_RECORD;
	   	recorder = Ti.Media.createAudioRecorder({
	   		//compression: Titanium.Media.AUDIO_FORMAT_APPLE_LOSSLESS,//.AUDIO_FORMAT_LINEAR_PCM,
	   		format: Titanium.Media.AUDIO_FILEFORMAT_WAVE//Titanium.Media.AUDIO_FILEFORMAT_MP4A//.AUDIO_FILEFORMAT_WAVE   		
	   	});
	}
	catch (x)
	{ // Android - use androidaudiorecorder instead
	    try
	    { 
			recorder = require('nz.ac.canterbury.nzilbb.androidaudiorecorder');
			Ti.API.info("Android recorder => " + recorder);
		}
		catch (x2)
		{
			Ti.API.info(x2);
			throw x2;
		}
			
	}
	try
	{
		recorder.start();
	}
	catch(x)
	{ // Android:
		recorder.start(-1,16000,1,-1);
	}
}

function stopRecording()
{
    $.aiRecording.hide(); 	
	Ti.API.info('stopRecording()');
	audioFile = recorder.stop();
	Ti.API.info('recorder stopped');
	Ti.API.info('file: ' + audioFile);
	if (!audioFile.name)
	{
		audioFile = Ti.Filesystem.getFile("/"+audioFile);
	}
	Ti.API.info('file: ' + audioFile.name + " " + audioFile.exists());
}


function playRecording()
{
	Ti.API.info('playRecording()');
	var audioPlayer = Ti.Media.createAudioPlayer({ url : audioFile.nativePath });
	audioPlayer.addEventListener('complete', function()
	{
		if (Ti.Platform.name === 'android') 
		{
			audioPlayer.release();
		}
	});
	audioPlayer.play();
}

function noTags(html) {
	if (!html) return "";
	return html.replace(/<[^>]+>/g,"").trim();
}

// download steps
var xhr = Titanium.Network.createHTTPClient();
xhr.onload = function(e) {
		$.index.open();
    	var data = JSON.parse(this.responseText);
    	settings = data.model;
		steps = data.model.steps; 
		$.pbOverall.show();
		$.btnNext.title = noTags(settings.resources.next);
		$.lblSignature.text = noTags(settings.resources.pleaseEnterYourNameHere);
		$.aiRecording.message = noTags(settings.resources.recording);
		startSession();
};
xhr.onerror = function(e) {
    	Ti.API.debug("STATUS: " + this.status);
    	Ti.API.debug("TEXT:   " + this.responseText);
    	Ti.API.debug("ERROR:  " + e.error);
    	alert('There was an error retrieving the remote data. Try again.');
    };
Ti.API.info('getting prompts...');
xhr.open("GET", startUrl);
xhr.send();

