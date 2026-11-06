using Toybox.Application;
using Toybox.WatchUi;

class MeinFaceApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function getInitialView() {
        return [ new MeinFaceView() ];
    }

    function onSettingsChanged() {
        WatchUi.requestUpdate();
    }
}
