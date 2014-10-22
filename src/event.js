'use strict';

var app = angular.module('rested');

app.factory('$event', function($log) {

    return function() {
        var events = {};
        var eventData = {};
        var eventPrefix = "";

        var object = {
            reset: function (type) {
                var index = eventPrefix + "_" + type;
                eventData[index] = undefined;
            },

            triggerOnce: function (type, data) {
                var index = eventPrefix + "_" + type;
                if(eventData[index] === undefined)
                    return object.trigger(type, data);

                return false;
            },

            trigger: function (type, data) {
                var index = eventPrefix + "_" + type;
                eventData[index] = data || null;

                if (!events[index])
                    return false;

                for (var i = 0; i < events[index].length; i++) {
                    if (events[index][i]) {
                        var res = events[index][i].call(null, data);
                        if (res === false)
                            delete events[index][i];
                    }
                }

                return true;
            },

            on: function (type, callback) {
                if (typeof callback !== "function") {
                    $log.warn("[Event] Listener needs to be a function");
                    return false;
                }

                var index = eventPrefix + "_" + type;
                if (!events[index])
                    events[index] = [];

                var keep = true;
                if (eventData[index] !== undefined)
                    keep = callback.call(null, eventData[index]);

                if (keep !== false)
                    events[index].push(callback);

                return keep;
            },

            setPrefix: function (prefix) {
                eventPrefix = prefix;
            }
        };

        return object;
    };
});
