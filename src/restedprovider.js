'use strict';

app.provider('$rested', function() {

    var defaultHeaders = {};
    var localStorage = false;
    var baseUrl = 'http://localhost/';
    var offline = false;
    var offlineQueue = [];

    var configure = {
        /**
        * Sets the base url for rested
        * @param {string} url - The url
        */
        setBaseUrl: function(url) {
            // Missing trailing slash in baseURL
            if(url.slice(-1) !== '/')
                url += '/';

            baseUrl = url;
        },

        setDefaultHeaders: function(headers) {
            defaultHeaders = headers;
        },

        setDefaultHeader: function(key, value) {
            defaultHeaders[key] = value;
        },

        useLocalStorage: function() {
            localStorage = true;
        },

        offline: function() {
            offline = true;
        },

        online: function() {
            offline = false;
        }
    };

    angular.extend(this, configure);

    this.$get = function($q, $http, $timeout, localStorageService, $event, $log) {
        $log = $log.getInstance('RestedProvider');

        var event = new $event();
        var stripMillis = function(obj) {
            for(var i in obj) {
                if(obj[i] instanceof Date) {
                    var utcTimeMillis = Date.UTC(obj[i].getUTCFullYear(),
                                                 obj[i].getUTCMonth(),
                                                 obj[i].getUTCDate(),
                                                 obj[i].getUTCHours(),
                                                 obj[i].getUTCMinutes(),
                                                 obj[i].getUTCSeconds());
                    obj[i] = parseInt(utcTimeMillis / 1000);
                } else if(typeof obj[i] === 'object') {
                    obj[i] = stripMillis(obj[i]);
                }
            }

            return obj;
        };

        return function(uri) {
            /**
             * @constructor
             * @param {string} uri
             */
            var object = function(uri) {
                this._params = {};
                this._routes = [];

                this._data = {};
                this._dataArray = [];
                this._dataArrayIds = {};

                this._isArray = false;

                if(typeof uri === 'string')
                    this._routes = uri.split('/');

                this.setDefaultHeader = configure.setDefaultHeader;
                this.setDefaultHeaders = configure.setDefaultHeaders;

                this.isOnline = function() {
                    return offline === false;
                };

                this.online = function() {
                    if(!this.isOnline()) {
                        configure.online();

                        for(var i in offlineQueue) {
                            var req = offlineQueue[i];
                            if(req) {
                                var request = this.fetch(req.opts);
                                request.then(req.resolve, req.reject, req.notify);
                            }
                        }

                        offlineQueue = [];
                    }
                };

                this.offline = function() {
                    configure.offline();
                };

                // Insert an object as the first child in the cache array
                this.prependCache = function(obj) {
                    if(localStorage) {
                        var uri = this.route(true, false);
                        var localData = localStorageService.get('rested:' + uri);

                        if(Array.isArray(localData)) {
                            localData.unshift(obj);
                            localStorageService.set('rested:' + uri, localData);
                            return true;
                        }
                    }

                    return false;
                };

                // Insert an object as the last child in the cache array
                this.appendCache = function(obj) {
                    if(localStorage) {
                        var uri = this.route(true, false);
                        var localData = localStorageService.get('rested:' + uri);

                        if(Array.isArray(localData)) {
                            localData.push(obj);
                            localStorageService.set('rested:' + uri, localData);
                            return true;
                        }
                    }

                    return false;
                };

                this.getCache = function() {
                    if(localStorage) {
                        var uri = this.route(true, false);
                        return localStorageService.get('rested:' + uri);
                    }
                };

                this.clearCache = function() {
                    if(localStorage) {
                        var uri = this.route(true, false);
                        $log.info('Clearing local storage updated for "' + uri + '"');
                        localStorageService.remove('rested:' + uri);
                        return true;
                    }

                    return false;

                };

                /**
                 * Change the route and sets the expected result to be a object
                 *
                 * example:
                 *  $rested().one('user');
                 *  $rested().one('users', 12);
                 *  $rested().one('users', [1, 12]);
                 *  $rested().one('users/12');
                 *
                 * @param {string} route - the route to be added
                 * @param {string/array} args (optional) - appends it to the route
                 * @return {rested} instance
                 */
                this.one = function(route, args) {
                    var newObj = new object();
                    newObj._routes = this._routes.slice(0);
                    newObj._isArray = false;

                    if(route)
                        newObj._routes.push(route);

                    if(args) {
                        if(args instanceof Array) {
                            for(var arg in args)
                                newObj._routes.push(arg);
                        } else
                            newObj._routes.push(args);
                    }

                    return newObj;
                };

                /**
                 * Change the route and sets the expected result to be a array
                 *
                 * example:
                 *  $rested().all('users');
                 *
                 * @param {string} route (optional) - the route to be added
                 * @return {rested} instance
                 */
                this.all = function(route) {
                    var newObj = new object();
                    newObj._routes = this._routes.slice(0);
                    newObj._isArray = true;

                    if(route)
                        newObj._routes.push(route);

                    return newObj;
                };

                /**
                 * Listens to update event.
                 * Notice: these event is broadcast globally.
                 *
                 * example:
                 *  $rested().getList('users').on('update', function(users) {
                 *      // your code here
                 *  });
                 *
                 * @param {string} type - which event to listen to, either localUpdate, remoteUpdate or update
                 * @param {function} callback - callback function that should be called
                 */
                this.on = function(type, callback) {
                    var route = this.route(false, false);
                    var eventIndex = '{0}_{1}'.format(route, type);
                    event.on(eventIndex, callback);
                };

                /**
                 * Fetching the route expecting the result is a object
                 *
                 * example:
                 *  $rested().one('user').get();
                 *  $rested().one('user').get({params: {id: 12}});
                 *  $rested().get('user');
                 *
                 * @param {string/object} route/opts -
                 *                          if string or array: appends the argument to the route
                 *                          if object: sets the requests options
                 * @param {function} callback - callback function that should be called
                 * @return {$q} resolver
                 */
                this.get = function(route, opts) {
                    if(opts === undefined)
                        opts = {};

                    if(route instanceof Object && !(route instanceof Array)) {
                        opts = route;
                        route = null;
                    }

                    if(!(opts instanceof Object) || opts instanceof Array)
                        opts = {args: opts};

                    angular.extend(opts, {
                        isArray: false,
                        method: 'get'
                    });

                    var self = route || opts.args ? this.one(route, opts.args) : this;
                    return self.params(opts.params).fetch(opts);
                };

                /**
                 * Fetching the route expecting the result is a array
                 *
                 * example:
                 *  $rested().all('users').getList();
                 *  $rested().all('users').getList({params: {limit: 42}});
                 *  $rested().getList('users');
                 *
                 * @param {string/object} route/opts -
                 *                          if string or array: appends the argument to the route
                 *                          if object: sets the requests options
                 * @param {function} callback - callback function that should be called
                 * @return {$q} resolver
                 */
                this.getList = function(route, opts) {
                    if(opts === undefined)
                        opts = {};

                    if(route instanceof Object && !(route instanceof Array)) {
                        opts = route;
                        route = null;
                    }

                    if(!(opts instanceof Object) || opts instanceof Array)
                        opts = {params: opts};

                    angular.extend(opts, {
                        isArray: true,
                        method: 'get'
                    });

                    var self = route ? this.all(route) : this;
                    return self.params(opts.params).fetch(opts);
                };

                this.params = function(data) {
                    if(data instanceof Object && !(data instanceof Array))
                        this._params = data;

                    return this;
                };

                this.save = function(data, opts) {
                    opts = opts || {};
                    data = data || {};
                    angular.extend(opts, {
                        isArray: false,
                        method: data.id ? 'put' : 'post',
                        data: data,
                        ignoreData: true,
                        ignoreLocal: true
                    });

                    return this.fetch(opts);
                };

                this.delete = function(opts) {
                    opts = opts || {};
                    angular.extend(opts, {
                        isArray: false,
                        method: 'delete',
                        ignoreData: true,
                        ignoreLocal: true
                    });
                    return this.fetch(opts);
                };

                this.clear = function() {
                    while(this._dataArray.length > 0)
                        this._dataArray.pop();

                    this._dataArrayIds = {};

                    for(var key in this._data)
                        delete this._data[key];
                };

                this.ids = function() {
                    return this._dataArrayIds;
                };

                this.data = function() {
                    return this._isArray ? this._dataArray : this._data;
                };

                /**
                 * Makes a request to the route with these specified options
                 *
                 * Available options:
                 *  - isArray: boolean to specified if the response should be the type array
                 *  - ignoreLocal: temporary not save the data in local storage
                 *  - ignoreData: doesn't save the data in memory, and defers the pure response
                 *  - prefer: option for prefered data (default, remote, local)
                 *  - extend: if isArray is true, extend the current data structure
                 *  - data: http data
                 *  - method: http method, default: get
                 *  - headers: http headers
                 *
                 * @param {object} opts - see all available options in the description
                 * @returns {$q} a resolver
                 */
                this.fetch = function(opts) {
                    var deferred = $q.defer();
                    opts = angular.copy(opts);

                    if(!this.isOnline()) {
                        $log.info('Saving in offline storage', opts);

                        if(['post', 'put', 'delete'].indexOf(opts.method) > 0) {

                            offlineQueue.push({
                                'deferred': deferred,
                                'opts': opts
                            });

                            return deferred.promise;
                        } else {
                            opts.prefer = 'local';
                        }
                    }

                    if(['default', 'local', 'remote'].indexOf(opts.prefer) === 0) {
                        $log.warn('Invalid fetch method, using default prefered settings.');
                    }

                    var self = this;
                    var uri = this.route(true, false);
                    var route = this.route(false, false);
                    var eventPrefix = '{0}_'.format(route);

                    this._isArray = opts.isArray;

                    opts.url = baseUrl + uri;
                    opts.method = opts.method || 'get';
                    opts.data = opts.data || {};
                    opts.extend = opts.extend || false;
                    opts.headers = opts.headers || {};

                    var fetchLocalData = function(opts) {
                        var innerDefer = $q.defer();
                        var localData = localStorageService.get('rested:' + uri);
                        if(localStorage && !opts.ignoreLocal && localData !== null) {
                            $log.info('Loaded local storage for "' + uri + '"');

                            self.__handleResponse(opts, localData, true).then(function(result) {
                                if(!opts.ignoreData) {
                                    event.trigger(eventPrefix + 'update', result);
                                    event.trigger(eventPrefix + 'localUpdate', result);
                                }

                                innerDefer.resolve(result);

                            }, innerDefer.reject);
                        } else {
                            innerDefer.reject();
                        }

                        return innerDefer.promise;
                    };

                    var fetchRemoteData = function(opts) {
                        var innerDefer = $q.defer();
                        self.request(opts).then(function(request) {
                            var response = request.data;

                            if(opts.method === 'delete')
                                self.clearCache(uri);

                            self.__handleResponse(opts, response).then(function(result) {
                                if(!opts.ignoreData) {
                                    event.trigger(eventPrefix + 'update', result);
                                    event.trigger(eventPrefix + 'remoteUpdate', result);
                                }

                                innerDefer.resolve(result);
                            }, innerDefer.reject);

                        }, innerDefer.reject);

                        return innerDefer.promise;
                    };

                    var prefer = {
                        remote: function(opts) {
                            fetchRemoteData(opts).then(deferred.resolve,
                                function() {
                                    fetchLocalData(opts).then(deferred.resolve, deferred.reject);
                                }
                            );
                        },

                        local: function(opts) {
                            fetchLocalData(opts).then(deferred.resolve,
                                function() {
                                    fetchRemoteData(opts).then(deferred.resolve, deferred.reject);
                                }
                            );
                        },

                        default: function(opts) {
                            fetchLocalData(opts).then(function(data) {
                                    deferred.resolve(data);
                                    fetchRemoteData(opts).then(deferred.resolve, deferred.reject);
                                },
                                function() {
                                    fetchRemoteData(opts).then(deferred.resolve, deferred.reject);
                                }
                            );
                        },
                    };

                    var preferedFetch = prefer[opts.prefer] || prefer['default'];
                    preferedFetch(opts);

                    var promise = deferred.promise;
                    angular.extend(promise, this);

                    return promise;
                };

                this.__handleResponse = function(opts, response, ignoreLocal) {
                    var deferred = $q.defer();
                    var uri = this.route(true, false);

                    opts.id = opts.id || 'id';

                    if(opts.ignoreData) {
                        deferred.resolve(response);
                        return deferred.promise;
                    }

                    if(this._isArray) {
                        if(!(response instanceof Array)) {
                            var reject = 'Response isn\'t of the type array';
                            $log.warn(reject, response);
                            deferred.reject(reject);
                        } else {
                            if(!opts.extend)
                                this.clear();

                            var index;
                            for(var i = 0; i < response.length; i++) {
                                if(!response[i])
                                    continue;

                                if(this._dataArrayIds[response[i][opts.id]] !== undefined) {
                                    index = this._dataArrayIds[response[i][opts.id]];
                                    this._dataArray[index] = response[i];
                                } else {
                                    index = this._dataArray.push(response[i]) - 1;

                                    if(response[i][opts.id])
                                        this._dataArrayIds[response[i][opts.id]] = index;
                                }
                            }

                            deferred.resolve(this._dataArray);

                            if(localStorage && !ignoreLocal) {
                                $log.info('Local storage updated for "' + uri + '"');
                                localStorageService.set('rested:' + uri, response);
                            } else {
                                $log.info('New data updated for "' + uri + '"');
                            }
                        }
                    } else {
                        this.clear();

                        if(response && response.id)
                            this._dataArrayIds[response.id] = 0;

                        angular.extend(this._data, response);
                        deferred.resolve(this._data);

                        if(localStorage && !opts.ignoreLocal && !ignoreLocal) {
                            $log.info('Local storage updated for "' + uri + '"');
                            localStorageService.set('rested:' + uri, this._data);
                        } else {
                            $log.info('New data updated for "' + uri + '"');
                        }
                    }

                    return deferred.promise;
                };

                this.request = function(opts) {
                    if(opts === undefined)
                        opts = {};

                    opts.method = opts.method || 'get';
                    opts.method = opts.method.toLowerCase();
                    opts.headers = opts.headers || {};

                    if(['get', 'post', 'put', 'delete'].indexOf(opts.method) < 0) {
                        var deferred = $q.defer();
                        deferred.reject('Invalid method type: ' + opts.method);
                        return deferred.promise;
                    }

                    angular.extend(opts.headers, defaultHeaders);

                    var config = {
                        method: opts.method,
                        url: opts.url,
                        data: stripMillis(opts.data) || {},
                        headers: opts.headers,
                        ignoreLoadingBar: opts.ignoreLoadingBar
                    };

                    return $http(config);
                };

                this.route = function(includeParams, includeBaseUrl) {

                    var result = this._routes.join('/');

                    if(includeBaseUrl) {
                        result = baseUrl + result;
                    }

                    if(includeParams) {
                        // Set params
                        var pairs = [];
                        var paramsClean = stripMillis(this._params);
                        for(var prop in paramsClean) {
                            if(paramsClean[prop] !== undefined) {
                                pairs.push(prop + '=' + paramsClean[prop]);
                            } else {
                                $log.warn('Missing argument "{0}"'.format(prop));
                            }
                        }

                        if(pairs.length > 0)
                            result = result + '?' + pairs.join('&');
                    }

                    return result;
                };
            };

            return new object(uri);
        };
    };
});
