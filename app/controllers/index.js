Ti.API.info("index.js...");
var settings = null;
var taskName = Ti.App.Properties.getString("taskName");
var startUrl = Ti.App.Properties.getString("startUrl") + taskName;
var prompt = (Titanium.Platform.name == "iOS" || Titanium.Platform.name == "iPhone OS")?$.htmlPrompt:$.lblPrompt;

var steps = [
	{
		prompt: "<p>Unfortunately, the task steps are not currently accessible. Please check you are connected to the internet.</p>",
		record: false
	}
];

var securely = require('bencoding.securely'); // https://github.com/benbahrenburg/Securely
var secureProperties = securely.createProperties({});

var uploader = require("nzilbb.uploader");
var lastUploaderStatus = "";
var indexLength = 2;
var httpAuthorization = "";

var imagesToDownload = 0;
var imagesDownloaded = 0;

// series-specific variables
var series = null;
var participantAttributes = null;
var recIndex = 0;
var consentShown = false;
var signature = null;
var consentDoc = null;
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
	var secondsLeft = ""+(Math.floor((countdownEnd - now) / 1000) + 1);
	$.lblCountDown.text = secondsLeft;
	if (countdownDisplay) {
		prompt.top = "5%";
		prompt.height = "70%";
		prompt.show();	
		setPrompt(settings.resources.countdownMessage);
		$.lblCountDown.show();
	}
	if (now >= countdownEnd) {
		killTimer();
		$.lblCountDown.hide();
		countdownCall();
	}
}

function isTablet() {
	/*
		Returns Boolean, true = device is a tablet
	*/
	var diag = 8;
	var osname = Ti.Platform.osname;
	switch(osname) {
		case 'ipad':
			return true;
		case 'android':
			var dpi = Ti.Platform.displayCaps.dpi;
			var w = Ti.Platform.displayCaps.platformWidth / dpi;
			var h = Ti.Platform.displayCaps.platformHeight / dpi;
			return (Math.sqrt(w*w+h*h) >= diag) ? true : false;
		default:
			return false;
	}
}
var tablet = isTablet();
function setPrompt(p) {
	if (prompt == $.htmlPrompt) {
		Ti.API.log("HTML prompt: " + p);
		$.htmlPrompt.html = "<html><body style='height: 100%; vertical-align: middle;'>"
		+"<div style='text-align: center; font-size: "+(tablet?"22":"14")+"pt; font-family: sans-serif; vertical-align:middle; height:100%;'>"
		+(p||"")
		+"</div></body></html>";
	} else {
		$.lblPrompt.text = noTags(p);
	}
	prompt.show();
}
function appendPrompt(prompt) {
	if (steps.length > currentStep && steps[currentStep].prompt) {
		setPrompt(steps[currentStep].prompt + prompt);
	} else {
		setPrompt(prompt);
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
				consentDoc = this.file;
				// create participant form
				createParticipantForm();				
		};
	client.onerror = function(e) {
				Ti.API.debug("Could no get consent PDF: " + e.error);
				// fall back to an HTML file
				generateConsentHtml(sig);
		};
	// Prepare the connection.
	client.open("GET", url);
	if (httpAuthorization) client.setRequestHeader("Authorization", httpAuthorization);
	client.file = Ti.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), series, taskName + "-consent.pdf");
	// Send the request.
	client.send();				

}
function generateConsentHtml(sig) {
	signature = sig;
	var htmlConsentFile = Ti.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), series, taskName + "-consent.html");
	htmlConsentFile.write("<html><body>\n"+settings.consent 
		+ "\n\n<div><u><i><big>&nbsp;&nbsp;"+sig+"&nbsp;&nbsp;</big></i></u></div>"
		+ "\n\n<div><i>"+new Date()+"</i></div>"
		+"\n<body></html>");
	consentDoc = htmlConsentFile;
	// create participant form
	createParticipantForm();				
}
function getNewParticipantId(participantAttributes) {
	if ($.txtUsername.value) { // their user ID is there participant ID
	   	participantAttributes.id = $.txtUsername.value;
	   	
    	Ti.API.info("participant ID is User ID "+participantAttributes.id);
		// save the attributes to a file
		var participantFile = Ti.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), series, "participant.json");
		participantFile.write(JSON.stringify(participantAttributes));
	} else {
		var xhr = Titanium.Network.createHTTPClient();
		xhr.onload = function(e) {
		   	var data = JSON.parse(this.responseText);
		   	participantAttributes.id = data.model.name;
		   	
	    	Ti.API.info("participant ID "+participantAttributes.id);
			// save the attributes to a file
			var participantFile = Ti.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), series, "participant.json");
			participantFile.write(JSON.stringify(participantAttributes));
		};
		xhr.onerror = function(e) {
		   	Ti.API.debug("ERROR:  " + e.error);
		   	// could not get ID, continue anyway...
		};
		Ti.API.info('getting new participant ID...');
		xhr.open("POST", settings.newParticipantUrl);
		if (httpAuthorization) xhr.setRequestHeader("Authorization", httpAuthorization);
		xhr.send(participantAttributes);
	}	
	// don't wait for that request, just press on...
	startNextStep();
}

// progress of all uploads
function uploadsProgress(uploads, message) {
	var transcriptCount = 0;
	var percentComplete = 0;
	var currentFile = null;
	for (transcriptName in uploads) {
		transcriptCount++;
		percentComplete += uploads[transcriptName].percentComplete; 
		if (uploads[transcriptName].status == "uploading...") {
			currentFile = transcriptName;
		}
	} // next upload
	if (transcriptCount > 0) {
		lastUploaderStatus = message || noTags(settings.resources.uploadingPleaseWait);
		lastUploaderStatus += " " + Math.floor(percentComplete / transcriptCount) + "%";
		if (currentFile) {
			lastUploaderStatus += " ("+currentFile+")";
		}
	} else {
		lastUploaderStatus = "";
	}
	
	// if we're actually displaying progress
	if (currentStep >= steps.length - 1
		// or we're looking at the preamble
		|| $.htmlPreamble.visible) {
		if (transcriptCount > 0) {
			$.pbOverall.max = 100;
			$.pbOverall.value = percentComplete / transcriptCount;
			if (!$.htmlPreamble.visible) { // display message only if we've just finished a task
				if ($.pbOverall.value == $.pbOverall.max) {
					$.lblUpload.text = noTags(settings.resources.uploadFinished);
				} else {
					$.lblUpload.text = message || noTags(settings.resources.uploadingPleaseWait);
				}
			}
		}
	}
}
function onProgressBar(e) {
	// user tapped the progress bar
	if (lastUploaderStatus) {
		// poor-man's toast notification
		$.lblUpload.text = lastUploaderStatus;
		setTimeout(function() { $.lblUpload.text = ""; }, 2000);
	}
}
// create an upload request for the audio file
function uploadFile(file) {
	Ti.API.info('uploadFile('+file.name+')');
	var sName = series + "-" + zeropad(++recIndex, indexLength);
	Ti.API.info('name '+sName+')');
	var transcriptName = sName + ".txt";
	var transcriptText =	 	
	// meta-data
	"app=mobile\r\n"
	+ "appVersion="+Titanium.App.version+"\r\n"
	+ "appPlatform="+Titanium.Platform.osname+" "+Titanium.Platform.version+" "+Titanium.Platform.architecture+"\r\n"
	+ "appDevice="+Titanium.Platform.model+"\r\n"
	+ steps[currentStep].tags + "\r\n"
	// prompt as comment
	+ "{" + noTags(steps[currentStep].prompt).replace(/\n/g," ") + "} "
	// transcript 
	+ steps[currentStep].transcript;
	var fTranscript = Ti.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), series, transcriptName);
	fTranscript.write(transcriptText);
	// move recording so it won't be cleaned up before we've finished with it
	var fAudio = Ti.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), series, sName + ".wav");
	file.move(fAudio.nativePath);
	var formData = {
		"content-type" : "application/json",
		num_transcripts : 1,
		todo : "upload",
		auto : "true",
		transcript_type : settings.transcriptType,
		corpus : settings.corpus,
		family_name : series,
		uploadfile1_0 : fTranscript,
	    uploadmedia1: fAudio
	  };
	if (consentPdf && !consentSent) {
		formData.doc = consentPdf;
	}
	consentSent = true;
	uploader.prod();
}

function deferredOnNext(e) {
	// always hide next button to prevent double-presses - show it again when we're ready
	$.btnNext.hide();
	
	// defer onNext for one second, to ensure the last of what they're saying gets recorded
	startTimer(0.5, onNext);	
}

function onNext() {

	if ($.login.visible) {
		downloadDefinition();
		return; 
	}
	
	if ($.btnNext.title == "Try Again"
	|| $.btnNext.title == noTags(settings.resources.startAgain)) {
		// download the task definition again, so that when tasks are updated, all apps get the changes for next session
		downloadDefinition();
		return;
	}
	Ti.API.info('Next...');
	if (!signature) {
		if (settings.consent && consentShown) {
			if ($.txtSignature.value == "") {
				alert(noTags(settings.resources.pleaseEnterYourNameToIndicateYourConsent));
				$.txtSignature.focus();
				showNextButton();
			} else {
				//generateConsentPdf($.txtSignature.value); calling the internet takes too long, just use HTML
				generateConsentHtml($.txtSignature.value);
			}
		} else {
			showConsent(); 
		}
	} else if (!participantAttributes) { // don't have a participant ID yet
		newParticipant();
	} else {
		// hide the button to stop double-clicks
		$.btnNext.hide();
	
		finishLastStep(); // which will automatically start the next step
	}
}

// starting point for an elicitation session
function startSession() {
	if (!settings) return;
	// ensure any previous participants are forgotten
	var now = new Date();
	series = zeropad(now.getFullYear(),4)
		+ zeropad(now.getMonth()+1,2) // getMonth() is 0-based
		+ zeropad(now.getDate(),2)
		+ "-" + zeropad(now.getHours(),2)
		+ zeropad(now.getMinutes(),2);
	// create a directory named after the series - this will be where all series-related files are kept until they're uploaded
    Ti.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), series).createDirectory();
    Ti.API.log(Ti.Filesystem.getApplicationDataDirectory());
    Ti.API.log(series);
	participantAttributes = null;
    recIndex = 0;
    consentShown = false;
    signature = null;
    consentPdf = null;
    consentSent = false;
    participantFormControls = {};
    currentStep = -1;
    Ti.API.info("startSession");
    // resent UI components
    $.txtSignature.value = "";
	$.pbOverall.value = 0;
	if (settings) {
		$.btnNext.title = noTags(settings.resources.next);
		$.pbOverall.message = noTags(settings.resources.overallProgess);
		$.aiRecording.message = noTags(settings.resources.recording);
	}
	$.lblUpload.text = "";
	clearPrompts();
	setPrompt("");
	$.aiRecording.hide();
	$.lblUpload.show();
	showNextButton();
    
    Ti.API.info("show preamble");
	// start user interface...
	showPreamble();
}

function showPreamble() {
	if (settings && settings.preamble) {
		$.htmlPreamble.html = settings.preamble;
		$.htmlPreamble.show();
		$.consent.hide();
		showNextButton();
	} else {
		showConsent();
	}
}

function showConsent() {
	$.htmlPreamble.hide();
	if (settings && settings.consent) {		
		$.htmlConsent.html = settings.consent;
		consentShown = true;
		$.consent.show();
		$.lblSignature.show();
		$.txtSignature.show();
		$.txtSignature.focus();
		showNextButton();
	} else {
		signature = " ";
		createParticipantForm();
	}
}

function checkbox_on() {
    this.backgroundColor = '#FFFFFF';
    this.color = '#000000';
	this.font = {fontSize: 25, fontWeight: 'bold'};
    this.selected = true;
    Ti.API.info("Selecting " + this.value);
    for (o in this.field.options)
    {
    	var option = this.field.options[o];
        Ti.API.info("option " + option.value + " chk: " + option.checkbox);
    	if (option.value != this.value && option.checkbox) option.checkbox.off();
    }
}

function checkbox_off() {
    this.backgroundColor = '#aaa';
    this.color = '#FFFFFF';
    this.selected = false;
	this.font = {fontSize: 25};
}

function checkbox_onClick(e) {
	Ti.API.info("click " + e.source.title);
    if(false==e.source.selected) {
        e.source.on();
    } else {
        e.source.off();
    }
}

function createParticipantForm()
{
	$.htmlPreamble.hide();
	$.consent.hide();
	$.txtSignature.blur(); // hides the soft keyboard if visible	
	$.pbOverall.value = 0;
	$.pbOverall.max = steps.length;
	if (settings.participantFields.length == 0 // no participant fields defined
		|| $.txtUsername.value) // or they've logged in with a user ID
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
		var tallLabelSlots = 2;
		var tallControlSlots = 3;
		for (f in settings.participantFields)
		{
			var field = settings.participantFields[f];
			if (field.label.length > 50) {
				slotCount += tallLabelSlots; // long label
			} else {
				slotCount++;
			}
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
			else if (field.type != "boolean") // booleans are added to label
			{
				slotCount++; // one-slot control
			}
		}
		var slotHeightPercentage = 100 / slotCount;
		var slotHeightPx = 40;
		var slot = 0; 
		for (f in settings.participantFields)
	    {
			var field = settings.participantFields[f];
			var label = Ti.UI.createLabel({ 
				text : field.label,
				color: "#000000",
				font: { fontSize: 20 },
				verticalAlign: Titanium.UI.TEXT_VERTICAL_ALIGNMENT_CENTER,
				textAlign: Titanium.UI.TEXT_ALIGNMENT_CENTER,
				width: "90%",
				top: String(slot*slotHeightPercentage) + "%", 
				height: String(slotHeightPercentage * (field.label.length > 50?tallLabelSlots:1)) + "%"});
			var labelSlot = slot;
			var labelSlotHeight = 1;
			if (field.label.length > 50) {
				slot+=tallLabelSlots;
				labelSlotHeight = tallLabelSlots; 
			} else {  
				slot++;
			}
			$.participantForm.add(label);
			var value = null;
			if (field.type == "select")
			{
				for (o in field.options) {
					field.options[o].checkbox = Ti.UI.createButton({
					    title: field.options[o].description,
					    borderColor: '#666',
					    borderWidth: 2,
					    borderRadius: 3,
					    backgroundColor: '#aaa',
					    backgroundImage: 'none',
					    color: '#fff',
					    font:{fontSize: 25, fontWeight: 'bold'},
					    selected: false,
					    value: field.options[o].value,
	  					top: String(slot*slotHeightPercentage)+"%", 
						width: "90%" 
						});
					slot++;
				}
				// separately, add radio-button events and link back to the field
				for (o in field.options) {
					field.options[o].checkbox.on = checkbox_on;					
					field.options[o].checkbox.off = checkbox_off;					
					field.options[o].checkbox.addEventListener('click', checkbox_onClick);
					field.options[o].checkbox.field = field;
					$.participantForm.add(field.options[o].checkbox);
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
				// boolean is a switch on the same line as the label
				value = Ti.UI.createSwitch({
					color: "#000000",
					borderWidth: 2,
  					borderColor: '#bbb',
  					borderRadius: 5,
					value: false,
					title: field.description,
					top: String(labelSlot*slotHeightPercentage) + "%", 
					width: "10%",
					right: 0});
				label.left = 0;
				label.width = "90%";
				label.textAlign = Titanium.UI.TEXT_ALIGNMENT_LEFT;
				if (labelSlotHeight > 1) { // tall label, so move the switch down towards the middle
					value.top = String((labelSlot*slotHeightPercentage) + (slotHeightPercentage * labelSlotHeight)/3) + "%";
				}
				try
				{
					value.style = Ti.UI.Android.SWITCH_STYLE_CHECKBOX;
				}
				catch (x)
				{}
				field.getValue = function() { return this.control.value?true:false; };
				// don't increment slot		
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
					textAlign: Titanium.UI.TEXT_ALIGNMENT_CENTER,
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
		showNextButton();
	}	
}

function newParticipant()
{
	Ti.API.info("newParticipant " + $.participantForm.visible);
	if ($.participantForm.visible) { // validate form
		var provisionalAttributes = {};
		Ti.API.info("validating...");
		for (f in settings.participantFields)
	    {
			var field = settings.participantFields[f];
			var value = field.getValue();
			Ti.API.info(field.attribute + " = " + value);
			if (!value && field.type != "boolean")
			{
				Ti.API.info(" no value for " + field.attribute);
				alert(noTags(settings.resources.pleaseSupplyAValueFor) + " " + field.label);
				showNextButton();
				return;
			}
			else if (field.type == "number")
			{
				if (isNaN(value))
				{
					alert(noTags(settings.resources.pleaseSupplyANumberFor) + " " + field.label);
					showNextButton();
					return;
				}
			}
			else if (field.type == "integer")
			{
				if (isNaN(value))
				{
					alert(noTags(settings.resources.pleaseSupplyANumberFor) + " " + field.label);
					showNextButton();
					return;
				}
				else
				{
					value = parseInt(value);
				}
			}
			// ensure keyboard is hidden if it's been made visible
			if (field.control && field.control.blur) field.control.blur();
			provisionalAttributes[field.attribute] = value;
		} // next field
		$.participantForm.hide();	
		$.participantForm.visible = false;
		participantAttributes = provisionalAttributes;
	} else {
		participantAttributes = {};
	}
	
	if (!$.participantForm.visible)
	{
	    participantAttributes["newSpeakerName"] = taskName+"-{0}";
		participantAttributes["content-type"] = "application/json";

		// save the attributes to a file
		var participantFile = Ti.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), series, "participant.json");
		participantFile.write(JSON.stringify(participantAttributes));

		getNewParticipantId(participantAttributes);
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
			if (steps[currentStep].record 
				&& (!steps[currentStep].image || !/.*mp4$/.test(steps[currentStep].image))) { // not video, which starts after playback
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
		setPrompt("");
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
		setPrompt(steps[currentStep].prompt);
	}
	else 
	{
		setPrompt("");
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
	if ($.lblTranscript.text.length > 300)
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

	// is there an image?
	if (steps[currentStep].image)
	{
		var url = "file://" + Ti.Filesystem.getApplicationDataDirectory() + steps[currentStep].image;
		Ti.API.log("image: " + url);
		if (/.*mp4$/.test(url)) {
			$.video.url = url;
			$.video.play();
		} else {
			$.image.image = url;
		} 
    }
	
	// rearrange UI depending on texts/media...
	
	// figure out what's there
	var proportionPrompt = steps[currentStep].prompt?1:0;
	var proportionTranscript = steps[currentStep].transcript?1:0;
	var proportionImage = steps[currentStep].image?1:0;
	var elementCount = proportionPrompt + proportionTranscript + proportionImage;
	// scale the elements to fit into 70%
	var elementShare = 70/elementCount;
	proportionPrompt *= elementShare;
	proportionTranscript *= elementShare;
	proportionImage *= elementShare;
	
	var topSoFar = 5;
	if (proportionPrompt) {
		prompt.top = ""+topSoFar+"%";
		prompt.height = ""+proportionPrompt+"%";
		prompt.show();	
	} else {
		prompt.hide();
	}	
	topSoFar += proportionPrompt;
	if (proportionTranscript) {
		$.lblTranscript.top = ""+topSoFar+"%";
		$.lblTranscript.height = ""+proportionTranscript+"%";
		$.lblTranscript.show();	
	} else {
		$.lblTranscript.hide();
	}	
	topSoFar += proportionTranscript;
	if (proportionImage) {
		if (/.*mp4$/.test(steps[currentStep].image)) { // video
			$.video.top = ""+topSoFar+"%";
			$.video.height = ""+proportionImage+"%";
			$.video.visible = true;	
			$.image.visible = false;
			$.image.image = null;
		} else { // image
			$.image.top = ""+topSoFar+"%";
			$.image.height = ""+proportionImage+"%";
			$.image.visible = true;	
			$.video.visible = false;
			$.video.url = null;
		}
	} else { // neither
			$.video.visible = false;
			$.video.url = null;
			$.image.visible = false;
			$.image.image = null;
	}	
		
	if (!steps[currentStep].image || !/.*mp4$/.test(steps[currentStep].image)) { // not playing a video
		if (currentStep < steps.length - 1 && steps[currentStep].record) {
			// reveal we are recording	
	    	$.aiRecording.show();
			$.lblUpload.hide();
	    	// and make sure they don't go over the max time
	    	startTimer(steps[currentStep].max_seconds, finishLastStep);
	    } 	
	    if (currentStep < steps.length - 1) {
	    	// show next button only if there's a next step
	    	if (steps[currentStep].suppress_next) {
	    	 	hideNextButton();
		    } else {
	    	 	showNextButton();
		    }
	    } else {
	    	$.lblCountDown.hide();
	    }
	}
}

function videoFinished() {
	if (currentStep < steps.length - 1) {
		 // show next button only if there's a next step
		 Ti.API.log("VIDEO finished, show next button"); 
		 showNextButton();
		
	 	 if (steps[currentStep].record) {
			 // start recording
	    	 Ti.API.log("VIDEO:...and start recording..."); 
			 startRecording();
			 // reveal we are recording	
	    	 Ti.API.log("VIDEO:...and show recording..."); 
	    	 $.aiRecording.show();
			 $.lblUpload.hide();
			 // and make sure they don't go over the max time
	    	 Ti.API.log("VIDEO:...and start max seconds timer..."); 
			 startTimer(steps[currentStep].max_seconds, finishLastStep);
	    	 Ti.API.log("VIDEO:...done"); 
		 }
	}
}
function clearPrompts() {
	$.lblTitle.text = "";
	setPrompt(settings?settings.resources.countdownMessage + "<br>":"Please Wait...");
	$.lblTranscript.text = "";
	$.image.hide();
	$.video.hide();	
}
function showNextButton() {
	$.lblCountDown.hide();
	setTimeout(function() { $.btnNext.show(); }, 1000); 	
}
function hideNextButton() {
	$.lblCountDown.text = "";
	$.lblCountDown.show();
	$.btnNext.hide(); 	
}

function finished()
{
	// ensure the prompt is visible
	prompt.top = "5%";
	prompt.height = "35%";
	prompt.show();	
	// ensure it doesn't cover up any final vide/image
	$.video.top = "40%";
	$.video.height = "35%";
	$.image.top = "40%";
	$.image.height = "35%";
	if (participantAttributes.id && !$.txtUsername.value) {
		appendPrompt(settings.resources.yourParticipantIdIs+"\n"+participantAttributes.id);
	}	    	
    Ti.API.log("finished - hiding next button");
    $.aiRecording.hide();
    $.lblUpload.show();
    
	$.btnNext.title = noTags(settings.resources.startAgain);
	// delay showing the "start again" button - in general they won't do this anyway, to it may be confusing
    setTimeout(function() { $.btnNext.show(); }, 10000); 
    
    // TODO open consent form 	
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
	
	if (Ti.Platform.name === 'android')
	{ // Android - use androidaudiorecorder
	    try
	    { 
			recorder = recorder || require('nz.ac.canterbury.nzilbb.androidaudiorecorder');
			Ti.API.info("Android recorder => " + recorder);
		}
		catch (x2)
		{
			Ti.API.info(x2);
			throw x2;
		}
			
	}
	else
	{ // iOS - use nzilbb.iosaudiorecorder
		try {
			recorder = require("nzilbb.iosaudiorecorder");
			Ti.API.log("iOS recorder => " + recorder);
		}
		catch (x)
		{
			Ti.API.info(x);
			throw x;
		}
	}
	
	recorder.start(-1,16000,1,-1);
}

function stopRecording()
{
    $.aiRecording.hide();
    $.lblUpload.show();
     	
	Ti.API.info('stopRecording()');
	try {
		audioFile = recorder.stop();
		Ti.API.info('recorder stopped');
		Ti.API.info('file: ' + audioFile);
		if (!audioFile.name)
		{
			audioFile = Ti.Filesystem.getFile("/"+audioFile);
		}
		Ti.API.info('file: ' + audioFile.name + " " + audioFile.exists());
	} catch (x) {
		Ti.API.debug("could not stop recording: " + x);
		throw x; 
	}
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
	return html
		.replace(/<p>/g,"\n")
		.replace(/<br>/g,"\n")
		.replace(/<[^>]+>/g,"")
		.replace(/&nbsp;/g," ")
		.replace(/&quot;/g,"\"")
		.replace(/&#39;/g,"'")
		.replace(/ +/g," ")
		.trim();
}

function zeropad(num, size) {
	var s = "000000" + num;
	return s.substr(s.length - size);
}

function waitForImages() {
	Ti.API.log("waitForImages "+imagesDownloaded+"/"+imagesToDownload);
	if (imagesToDownload > imagesDownloaded) {
		$.pbOverall.show();
		$.pbOverall.max = imagesToDownload;
		$.pbOverall.value = imagesDownloaded;
		$.pbOverall.message = noTags(settings.resources.countdownMessage) + " ("+imagesDownloaded+" / " + imagesToDownload + ")";
		setTimeout(waitForImages, 1000);
	} else {
	 	startSession();
	}
}

function loadSettings() {
	Ti.API.info("loadSettings");

	var settingsFile = Ti.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), "settings.json");
	var blob = settingsFile.read();
	if (blob != null) {
		settings = JSON.parse(blob.text);
		steps = createStepsInstanceFromDefinition(settings.steps, "ordered", 0);
		var numRecordings = 0;
		for (step in steps) {
			if (steps[step].record) numRecordings++;
		}		
		indexLength = String(numRecordings).length; 
		$.pbOverall.show();
		$.btnNext.title = noTags(settings.resources.next);
		$.lblSignature.text = noTags(settings.resources.pleaseEnterYourNameHere);
		$.aiRecording.message = noTags(settings.resources.recording);
	} else {
		Ti.API.info('No internet, and no saved settings. Nothing to do.');	
		$.lblTitle.text = "Please ensure you're connected to the internet the first time you run this app";			
		$.consent.hide();
		$.htmlPreamble.hide();
		$.btnNext.title = "Try Again";
		$.btnNext.show();
	}
}

// recursively creates task steps to use, based on the defined steps, and the sample configuration, 
// which may specify that steps are randomly ordered and/or only a subset are used
function createStepsInstanceFromDefinition(steps, sample, step_count) {
    // random order?
    if (/.*random.*/.test(sample)) {
	steps = shuffle(steps.slice()); // shuffle a copy
    }
    // sample only?
    if (!/.*sample.*/.test(sample) || step_count == 0) {
	step_count = steps.length;
    }
    var stepsInstance = [];
    for (var i = 0; i < step_count; i++) {
        var step = steps[i];
	// if the step has more than just a title
	if (step.prompt || step.transcript || step.image) {
	    // include it
	    stepsInstance.push(step);
	}
	// does this step have children?
	if (step.steps) {
	    stepsInstance = stepsInstance.concat(
		createStepsInstanceFromDefinition( // recursive call
		    step.steps, step.sample, step.step_count));
	}
    } // next step
    return stepsInstance;
}

// Fisher-Yates (aka Knuth) array shuffling
// thanks to http://www.itsmycodeblog.com/shuffling-a-javascript-array/
function shuffle(array) {
  var currentIndex = array.length, temporaryValue, randomIndex ;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}

function downloadStepImage(step) {
    var f = Titanium.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), step.image);
	Ti.API.log("file: " + f.name + " " + f.exists());
    if (f.exists()) {
    	imagesDownloaded++;
    } else {
		var c = Titanium.Network.createHTTPClient();
		c.imageName = step.image;
		Ti.API.log("downloading: " + settings.imageBaseUrl + step.image);
		c.onload = function() {
	    	if (this.status == 200 ) {
	    		Ti.API.info("Saved " + this.imageName);
	            var f = Titanium.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), this.imageName);
	            f.write(this.responseData);
	            imagesDownloaded++;
	       } else {
	        Ti.API.log("ERROR downloading image: " + c.status);
	        downloadStepImage(step); // keep trying
	       }
	    };
	    c.error = function(e) { 
	        Ti.API.log("ERROR downloading image: " + e.error);
	        downloadStepImage(step); // keep trying
	    };
	    c.open('GET', settings.imageBaseUrl + step.image);
		if (httpAuthorization) c.setRequestHeader("Authorization", httpAuthorization);
		c.send();
	}   	
}

function loginForm() {
	$.participantForm.hide();
	$.lblPrompt.hide();
	$.htmlPrompt.hide();
	$.htmlPreamble.hide();
	$.consent.hide();
	$.btnNext.show();
	Ti.API.info("login form...");
	if ($.txtUsername.value) {
		$.lblLoginPrompt.text = "Please try again";
	}
	$.login.show();
}

function downloadDefinition() {
	Ti.API.info("downloadDefinition()");

	// initial state of UI
	$.lblPrompt.hide();
	$.htmlPrompt.hide();
	$.btnNext.hide();
	$.lblCountDown.hide();
	$.aiRecording.hide();
	$.lblSignature.hide();
	$.txtSignature.hide();
	$.btnNext.hide();
	$.login.hide();
	$.consent.show();
	
	if (!$.txtUsername.value) {
		// are there stored credentials?
		$.txtUsername.value = secureProperties.getString("username");
		$.txtPassword.value = secureProperties.getString("password");
	}
	
	// download steps
	try {
		Ti.API.info("Titanium.Network.createHTTPClient");
		var xhr = Titanium.Network.createHTTPClient();
		Ti.API.info("...");
		xhr.onload = function(e) {
			Ti.API.info("onload");
			// if they used a username
			if ($.txtUsername.value) {
				// save the credentials
				secureProperties.setString("username", $.txtUsername.value);
				secureProperties.setString("password", $.txtPassword.value);
			}
			var data = JSON.parse(this.responseText);
			if (data.errors.length) {
				// there was a problem	
				$.lblTitle.text = "Sorry, the task definition could not be loaded:";
				setPrompt("");	
				for (e in data.errors) {
				Ti.API.info("task failed to load: " + data.errors[e]);
					setPrompt(data.errors[e] + "<br>");
				}		
				$.consent.hide();
				$.htmlPreamble.hide();
				$.btnNext.title = "Try Again";
    			$.btnNext.show();
			} else {
				// save settings to a file so we'll work offline later...
				var settingsFile = Ti.Filesystem.getFile(Ti.Filesystem.getApplicationDataDirectory(), "settings.json");
				settingsFile.write(JSON.stringify(settings = data.model));
				// now load them back...
				loadSettings();

				// download images so they'll be visible offline
				Ti.API.info("Looking for images...");
				imagesToDownload = 0;
				imagesDownloaded = 0;
				var flatStepsList = allSteps(data.model.steps);
			    for (s in flatStepsList) {
					var step = flatStepsList[s];
					if (step.image) {
						imagesToDownload++;
						downloadStepImage(step);
					}
				}				
				Ti.API.info("ensure all images are downloaded");
				waitForImages();
				
				// start uploader
				if (!uploader.initialised) {
					uploader.initialise(settings, Ti.Filesystem.getApplicationDataDirectory(), uploadsProgress, httpAuthorization);
				}
			}		
		};
		xhr.onerror = function(e) {
			// cannot load from the internet,
			if (this.status == 401) { // forbidden
				// ask for username/password
				Ti.API.info("authentication required: " + this.statusText + " - " + e.error);
				loginForm();
			} else { // probably just not connected to the internet
				// use settings from last time
				Ti.API.info("settings failed to load: " + e.error + " status " + this.status + " " + this.statusText);
				loadSettings();
				startSession();
			}
		};
		Ti.API.info('getting prompts...');
		xhr.open("GET", startUrl);
		if ($.txtUsername.value) {
			Ti.API.info("using authentication");
			httpAuthorization = "Basic "+Titanium.Utils.base64encode($.txtUsername.value+':'+$.txtPassword.value);
			xhr.setRequestHeader("Authorization", httpAuthorization);
		} else {
			authorization = null;
		}
		xhr.send();
	} catch (x) {
		Ti.API.error('Failed to get prompts: ' + x);
		loadSettings();
		startSession();
	}
}

// recursively return all steps
function allSteps(steps) {
    var list = [];
    for (s in steps) {
		list.push(steps[s]);
		if (steps[s].steps) {
		    list = list.concat(allSteps(steps[s].steps));
		}
    } // next step
    return list;
}
/*
try {
	var service = Ti.App.iOS.registerBackgroundService({url:'background.js'}); // in lib folder
} catch (bgx) {
	Ti.API.log("Could not register background service: " + bgx);
}
*/

downloadDefinition();

$.index.open();

if (Titanium.Platform.name == "iOS" || Titanium.Platform.name == "iPhone OS") {
	Titanium.Media.requestAudioPermissions(function(e) {
        if (e.success) {
            Ti.API.info("Audio permission SUCCESS");
        } else {
            Ti.API.info("Audio permission ERROR: " + e.error);
        }
    });
} else {
	// request permission to record audio
	Ti.Android.requestPermissions(["android.permission.RECORD_AUDIO"], function(e) {
        if (e.success) {
            Ti.API.info("Audio permission SUCCESS");
        } else {
            Ti.API.info("Audio permission ERROR: " + e.error);
        }
    });
}
Ti.API.info("index.js finished.");

