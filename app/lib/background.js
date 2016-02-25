Ti.API.info('background: service starting');
Ti.App.currentService.stop();

var listener = Ti.App.currentService.addEventListener('stop',function(){
  Ti.API.info('background: service stopping');
});