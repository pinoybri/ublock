(function() {
    if ( /(^|\.)twitch\.tv$/.test(document.location.hostname) === false ) { return; }
    'use strict';
    const ourTwitchAdSolutionsVersion = 20;
    if (typeof window.twitchAdSolutionsVersion !== 'undefined' && window.twitchAdSolutionsVersion >= ourTwitchAdSolutionsVersion) {
        window.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;
        return;
    }
    window.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;
    function declareOptions(scope) {
        scope.AdSignifier = 'stitched';
        scope.ClientID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
        scope.BackupPlayerTypes = ['embed', 'popout', 'autoplay'];
        scope.FallbackPlayerType = 'embed';
        scope.ForceAccessTokenPlayerType = 'popout';
        scope.SkipPlayerReloadOnHevc = false;
        scope.AlwaysReloadPlayerOnAd = false;
        scope.ReloadPlayerAfterAd = true;
        scope.PlayerReloadMinimalRequestsTime = 1500;
        scope.PlayerReloadMinimalRequestsPlayerIndex = 2;
        scope.HasTriggeredPlayerReload = false;
        scope.StreamInfos = [];
        scope.StreamInfosByUrl = [];
        scope.GQLDeviceID = null;
        scope.ClientVersion = null;
        scope.ClientSession = null;
        scope.ClientIntegrityHeader = null;
        scope.AuthorizationHeader = undefined;
        scope.SimulatedAdsDepth = 0;
        scope.PlayerBufferingFix = true;
        scope.PlayerBufferingDelay = 500;
        scope.PlayerBufferingSameStateCount = 3;
        scope.PlayerBufferingDangerZone = 1;
        scope.PlayerBufferingDoPlayerReload = false;
        scope.PlayerBufferingMinRepeatDelay = 5000;
        scope.V2API = false;
        scope.IsAdStrippingEnabled = true;
        scope.AdSegmentCache = new Map();
        scope.AllSegmentsAreAdSegments = false;
    }
    let isActivelyStrippingAds = false;
    let localStorageHookFailed = false;
    const twitchWorkers = [];
    const workerStringConflicts = ['twitch', 'isVariantA'];
    const workerStringAllow = [];
    const workerStringReinsert = ['isVariantA', 'besuper/', '${patch_url}'];
    function getCleanWorker(worker) {
        let root = null;
        let parent = null;
        let proto = worker;
        while (proto) {
            const workerString = proto.toString();
            if (workerStringConflicts.some((x) => workerString.includes(x)) && !workerStringAllow.some((x) => workerString.includes(x))) {
                if (parent !== null) {
                    Object.setPrototypeOf(parent, Object.getPrototypeOf(proto));
                }
            } else {
                if (root === null) { root = proto; }
                parent = proto;
            }
            proto = Object.getPrototypeOf(proto);
        }
        return root;
    }
    function getWorkersForReinsert(worker) {
        const result = [];
        let proto = worker;
        while (proto) {
            if (workerStringReinsert.some((x) => proto.toString().includes(x))) {
                result.push(proto);
            }
            proto = Object.getPrototypeOf(proto);
        }
        return result;
    }
    function reinsertWorkers(worker, reinsert) {
        let parent = worker;
        for (let i = 0; i < reinsert.length; i++) {
            Object.setPrototypeOf(reinsert[i], parent);
            parent = reinsert[i];
        }
        return parent;
    }
    function isValidWorker(worker) {
        const workerString = worker.toString();
        return !workerStringConflicts.some((x) => workerString.includes(x))
            || workerStringAllow.some((x) => workerString.includes(x))
            || workerStringReinsert.some((x) => workerString.includes(x));
    }
    function hookWindowWorker() {
        const reinsert = getWorkersForReinsert(window.Worker);
        const newWorker = class Worker extends getCleanWorker(window.Worker) {
            constructor(twitchBlobUrl, options) {
                let isTwitchWorker = false;
                try { isTwitchWorker = new URL(twitchBlobUrl).origin.endsWith('.twitch.tv'); } catch {}
                if (!isTwitchWorker) {
                    super(twitchBlobUrl, options);
                    return;
                }
                const newBlobStr = `
                    const pendingFetchRequests = new Map();
                    ${stripAdSegments.toString()}
                    ${getStreamUrlForResolution.toString()}
                    ${processM3U8.toString()}
                    ${hookWorkerFetch.toString()}
                    ${declareOptions.toString()}
                    ${getAccessToken.toString()}
                    ${gqlRequest.toString()}
                    ${parseAttributes.toString()}
                    ${getWasmWorkerJs.toString()}
                    ${getServerTimeFromM3u8.toString()}
                    ${replaceServerTimeInM3u8.toString()}
                    const workerString = getWasmWorkerJs('${twitchBlobUrl.replaceAll("'", "%27")}');
                    declareOptions(self);
                    GQLDeviceID = ${GQLDeviceID ? "'" + GQLDeviceID + "'" : null};
                    AuthorizationHeader = ${AuthorizationHeader ? "'" + AuthorizationHeader + "'" : undefined};
                    ClientIntegrityHeader = ${ClientIntegrityHeader ? "'" + ClientIntegrityHeader + "'" : null};
                    ClientVersion = ${ClientVersion ? "'" + ClientVersion + "'" : null};
                    ClientSession = ${ClientSession ? "'" + ClientSession + "'" : null};
                    self.addEventListener('message', function(e) {
                        if (e.data.key == 'UpdateClientVersion') {
                            ClientVersion = e.data.value;
                        } else if (e.data.key == 'UpdateClientSession') {
                            ClientSession = e.data.value;
                        } else if (e.data.key == 'UpdateClientId') {
                            ClientID = e.data.value;
                        } else if (e.data.key == 'UpdateDeviceId') {
                            GQLDeviceID = e.data.value;
                        } else if (e.data.key == 'UpdateClientIntegrityHeader') {
                            ClientIntegrityHeader = e.data.value;
                        } else if (e.data.key == 'UpdateAuthorizationHeader') {
                            AuthorizationHeader = e.data.value;
                        } else if (e.data.key == 'FetchResponse') {
                            const responseData = e.data.value;
                            if (pendingFetchRequests.has(responseData.id)) {
                                const { resolve, reject } = pendingFetchRequests.get(responseData.id);
                                pendingFetchRequests.delete(responseData.id);
                                if (responseData.error) {
                                    reject(new Error(responseData.error));
                                } else {
                                    const response = new Response(responseData.body, {
                                        status: responseData.status,
                                        statusText: responseData.statusText,
                                        headers: responseData.headers
                                    });
                                    resolve(response);
                                }
                            }
                        } else if (e.data.key == 'TriggeredPlayerReload') {
                            HasTriggeredPlayerReload = true;
                        } else if (e.data.key == 'SimulateAds') {
                            SimulatedAdsDepth = e.data.value;
                        } else if (e.data.key == 'AllSegmentsAreAdSegments') {
                            AllSegmentsAreAdSegments = !AllSegmentsAreAdSegments;
                        }
                    });
                    hookWorkerFetch();
                    eval(workerString);
                `;
                super(URL.createObjectURL(new Blob([newBlobStr])), options);
                twitchWorkers.push(this);
                this.addEventListener('message', (e) => {
                    if (e.data.key == 'UpdateAdBlockBanner') {
                        updateAdblockBanner(e.data);
                    } else if (e.data.key == 'PauseResumePlayer') {
                        doTwitchPlayerTask(true, false);
                    } else if (e.data.key == 'ReloadPlayer') {
                        doTwitchPlayerTask(false, true);
                    }
                });
                this.addEventListener('message', async event => {
                    if (event.data.key == 'FetchRequest') {
                        const fetchRequest = event.data.value;
                        const responseData = await handleWorkerFetchRequest(fetchRequest);
                        this.postMessage({ key: 'FetchResponse', value: responseData });
                    }
                });
            }
        };
        let workerInstance = reinsertWorkers(newWorker, reinsert);
        Object.defineProperty(window, 'Worker', {
            get: function() { return workerInstance; },
            set: function(value) { if (isValidWorker(value)) { workerInstance = value; } }
        });
    }
    function getWasmWorkerJs(twitchBlobUrl) {
        const req = new XMLHttpRequest();
        req.open('GET', twitchBlobUrl, false);
        req.overrideMimeType("text/javascript");
        req.send();
        return req.responseText;
    }
    function hookWorkerFetch() {
        const realFetch = fetch;
        fetch = async function(url, options) {
            if (typeof url === 'string') {
                if (AdSegmentCache.has(url)) {
                    return new Promise(function(resolve, reject) {
                        realFetch('data:video/mp4;base64,AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA', options)
                        .then(resolve).catch(reject);
                    });
                }
                url = url.trimEnd();
                if (url.endsWith('m3u8')) {
                    return new Promise(function(resolve, reject) {
                        realFetch(url, options).then(async function(response) {
                            if (response.status === 200) {
                                resolve(new Response(await processM3U8(url, await response.text(), realFetch)));
                            } else { resolve(response); }
                        }).catch(reject);
                    });
                } else if (url.includes('/channel/hls/') && !url.includes('picture-by-picture')) {
                    V2API = url.includes('/api/v2/');
                    const channelName = (new URL(url)).pathname.match(/([^\/]+)(?=\.\w+$)/)[0];
                    if (ForceAccessTokenPlayerType) {
                        const tempUrl = new URL(url);
                        tempUrl.searchParams.delete('parent_domains');
                        url = tempUrl.toString();
                    }
                    return new Promise(function(resolve, reject) {
                        realFetch(url, options).then(async function(response) {
                            if (response.status == 200) {
                                const encodingsM3u8 = await response.text();
                                const serverTime = getServerTimeFromM3u8(encodingsM3u8);
                                let streamInfo = StreamInfos[channelName];
                                if (streamInfo != null && streamInfo.EncodingsM3U8 != null && (await realFetch(streamInfo.EncodingsM3U8.match(/^https:.*\.m3u8$/m)[0])).status !== 200) {
                                    streamInfo = null;
                                }
                                if (streamInfo == null || streamInfo.EncodingsM3U8 == null) {
                                    StreamInfos[channelName] = streamInfo = {
                                        ChannelName: channelName, IsShowingAd: false, LastPlayerReload: 0, EncodingsM3U8: encodingsM3u8, ModifiedM3U8: null, IsUsingModifiedM3U8: false, UsherParams: (new URL(url)).search, RequestedAds: new Set(), Urls: [], ResolutionList: [], BackupEncodingsM3U8Cache: [], ActiveBackupPlayerType: null, IsMidroll: false, IsStrippingAdSegments: false, NumStrippedAdSegments: 0
                                    };
                                    const lines = encodingsM3u8.replaceAll('\r', '').split('\n');
                                    for (let i = 0; i < lines.length - 1; i++) {
                                        if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1].includes('.m3u8')) {
                                            const attributes = parseAttributes(lines[i]);
                                            const resolution = attributes['RESOLUTION'];
                                            if (resolution) {
                                                const resolutionInfo = { Resolution: resolution, FrameRate: attributes['FRAME-RATE'], Codecs: attributes['CODECS'], Url: lines[i + 1] };
                                                streamInfo.Urls[lines[i + 1]] = resolutionInfo;
                                                streamInfo.ResolutionList.push(resolutionInfo);
                                            }
                                            StreamInfosByUrl[lines[i + 1]] = streamInfo;
                                        }
                                    }
                                    const nonHevcResolutionList = streamInfo.ResolutionList.filter((element) => element.Codecs.startsWith('avc') || element.Codecs.startsWith('av0'));
                                    if (AlwaysReloadPlayerOnAd || (nonHevcResolutionList.length > 0 && streamInfo.ResolutionList.some((element) => element.Codecs.startsWith('hev') || element.Codecs.startsWith('hvc')) && !SkipPlayerReloadOnHevc)) {
                                        if (nonHevcResolutionList.length > 0) {
                                            for (let i = 0; i < lines.length - 1; i++) {
                                                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                                                    const resSettings = parseAttributes(lines[i].substring(lines[i].indexOf(':') + 1));
                                                    if (resSettings['CODECS'].startsWith('hev') || resSettings['CODECS'].startsWith('hvc')) {
                                                        const [targetWidth, targetHeight] = resSettings['RESOLUTION'].split('x').map(Number);
                                                        const newRes = nonHevcResolutionList.sort((a, b) => {
                                                            const [swA, shA] = a.Resolution.split('x').map(Number);
                                                            const [swB, shB] = b.Resolution.split('x').map(Number);
                                                            return Math.abs((swA * shA) - (targetWidth * targetHeight)) - Math.abs((swB * shB) - (targetWidth * targetHeight));
                                                        })[0];
                                                        lines[i] = lines[i].replace(/CODECS="[^"]+"/, `CODECS="${newRes.Codecs}"`);
                                                        lines[i + 1] = newRes.Url + ' '.repeat(i + 1);
                                                    }
                                                }
                                            }
                                        }
                                        if (nonHevcResolutionList.length > 0 || AlwaysReloadPlayerOnAd) { streamInfo.ModifiedM3U8 = lines.join('\n'); }
                                    }
                                }
                                streamInfo.LastPlayerReload = Date.now();
                                resolve(new Response(replaceServerTimeInM3u8(streamInfo.IsUsingModifiedM3U8 ? streamInfo.ModifiedM3U8 : streamInfo.EncodingsM3U8, serverTime)));
                            } else { resolve(response); }
                        }).catch(reject);
                    });
                }
            }
            return realFetch.apply(this, arguments);
        };
    }
    function getServerTimeFromM3u8(encodingsM3u8) {
        const regex = V2API ? /#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="([^"]+)"/ : /SERVER-TIME="([0-9.]+)"/;
        const matches = encodingsM3u8.match(regex);
        return (matches && matches.length > 1) ? matches[1] : null;
    }
    function replaceServerTimeInM3u8(encodingsM3u8, newServerTime) {
        if (!newServerTime) return encodingsM3u8;
        if (V2API) { return encodingsM3u8.replace(/(#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE=")[^"]+(")/, `$1${newServerTime}$2`); }
        return encodingsM3u8.replace(new RegExp('(SERVER-TIME=")[0-9.]+"'), `SERVER-TIME="${newServerTime}"`);
    }
    function stripAdSegments(textStr, stripAllSegments, streamInfo) {
        let hasStrippedAdSegments = false;
        const lines = textStr.replaceAll('\r', '').split('\n');
        const newAdUrl = 'https://twitch.tv';
        for (let i = 0; i < lines.length; i++) {
            lines[i] = lines[i].replaceAll(/(X-TV-TWITCH-AD-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`)
                               .replaceAll(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`);
            if (i < lines.length - 1 && lines[i].startsWith('#EXTINF') && (!lines[i].includes(',live') || stripAllSegments || AllSegmentsAreAdSegments)) {
                if (!AdSegmentCache.has(lines[i + 1])) { streamInfo.NumStrippedAdSegments++; }
                AdSegmentCache.set(lines[i + 1], Date.now());
                hasStrippedAdSegments = true;
            }
            if (lines[i].includes(AdSignifier)) { hasStrippedAdSegments = true; }
        }
        if (hasStrippedAdSegments) {
            for (let i = 0; i < lines.length; i++) { if (lines[i].startsWith('#EXT-X-TWITCH-PREFETCH:')) { lines[i] = ''; } }
        } else { streamInfo.NumStrippedAdSegments = 0; }
        streamInfo.IsStrippingAdSegments = hasStrippedAdSegments;
        AdSegmentCache.forEach((val, key, map) => { if (val < Date.now() - 120000) { map.delete(key); } });
        return lines.join('\n');
    }
    function getStreamUrlForResolution(encodingsM3u8, resolutionInfo) {
        const encodingsLines = encodingsM3u8.replaceAll('\r', '').split('\n');
        const [targetWidth, targetHeight] = resolutionInfo.Resolution.split('x').map(Number);
        let matchedResolutionUrl = null, matchedFrameRate = false, closestResolutionUrl = null, closestDiff = Infinity;
        for (let i = 0; i < encodingsLines.length - 1; i++) {
            if (encodingsLines[i].startsWith('#EXT-X-STREAM-INF') && encodingsLines[i + 1].includes('.m3u8')) {
                const attr = parseAttributes(encodingsLines[i]);
                const res = attr['RESOLUTION'];
                if (res) {
                    if (res == resolutionInfo.Resolution && (!matchedResolutionUrl || (!matchedFrameRate && attr['FRAME-RATE'] == resolutionInfo.FrameRate))) {
                        matchedResolutionUrl = encodingsLines[i + 1];
                        matchedFrameRate = attr['FRAME-RATE'] == resolutionInfo.FrameRate;
                        if (matchedFrameRate) return matchedResolutionUrl;
                    }
                    const [w, h] = res.split('x').map(Number);
                    const diff = Math.abs((w * h) - (targetWidth * targetHeight));
                    if (diff < closestDiff) { closestResolutionUrl = encodingsLines[i + 1]; closestDiff = diff; }
                }
            }
        }
        return closestResolutionUrl;
    }
    async function processM3U8(url, textStr, realFetch) {
        const streamInfo = StreamInfosByUrl[url];
        if (!streamInfo) return textStr;
        if (HasTriggeredPlayerReload) { HasTriggeredPlayerReload = false; streamInfo.LastPlayerReload = Date.now(); }
        if (textStr.includes(AdSignifier) || SimulatedAdsDepth > 0) {
            streamInfo.IsMidroll = textStr.includes('"MIDROLL"') || textStr.includes('"midroll"');
            if (!streamInfo.IsShowingAd) {
                streamInfo.IsShowingAd = true;
                postMessage({ key: 'UpdateAdBlockBanner', isMidroll: streamInfo.IsMidroll, hasAds: true, isStrippingAdSegments: false });
            }
            if (!streamInfo.IsMidroll) {
                const lines = textStr.replaceAll('\r', '').split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith('#EXTINF') && lines.length > i + 1 && !lines[i].includes(',live') && !streamInfo.RequestedAds.has(lines[i + 1])) {
                        streamInfo.RequestedAds.add(lines[i + 1]);
                        fetch(lines[i + 1]).then((r)=>{r.blob()});
                        break;
                    }
                }
            }
            const curRes = streamInfo.Urls[url];
            if (!curRes) return textStr;
            const isHevc = curRes.Codecs.startsWith('hev') || curRes.Codecs.startsWith('hvc');
            if (((isHevc && !SkipPlayerReloadOnHevc) || AlwaysReloadPlayerOnAd) && streamInfo.ModifiedM3U8 && !streamInfo.IsUsingModifiedM3U8) {
                streamInfo.IsUsingModifiedM3U8 = true;
                streamInfo.LastPlayerReload = Date.now();
                postMessage({ key: 'ReloadPlayer' });
            }
            let backupM3u8 = null, fallbackM3u8 = null, startIndex = (streamInfo.LastPlayerReload > Date.now() - PlayerReloadMinimalRequestsTime) ? PlayerReloadMinimalRequestsPlayerIndex : 0;
            for (let pIdx = startIndex; !backupM3u8 && pIdx < BackupPlayerTypes.length; pIdx++) {
                const pType = BackupPlayerTypes[pIdx];
                const realPType = pType.replace('-CACHED', '');
                for (let i = 0; i < 2; i++) {
                    let encM3u8 = streamInfo.BackupEncodingsM3U8Cache[pType];
                    if (!encM3u8) {
                        try {
                            const accRes = await getAccessToken(streamInfo.ChannelName, realPType);
                            if (accRes.status === 200) {
                                const acc = await accRes.json();
                                const uInfo = new URL('https://usher.ttvnw.net/api/' + (V2API ? 'v2/' : '') + 'channel/hls/' + streamInfo.ChannelName + '.m3u8' + streamInfo.UsherParams);
                                uInfo.searchParams.set('sig', acc.data.streamPlaybackAccessToken.signature);
                                uInfo.searchParams.set('token', acc.data.streamPlaybackAccessToken.value);
                                const encRes = await realFetch(uInfo.href);
                                if (encRes.status === 200) encM3u8 = streamInfo.BackupEncodingsM3U8Cache[pType] = await encRes.text();
                            }
                        } catch (err) {}
                    }
                    if (encM3u8) {
                        try {
                            const sM3u8Url = getStreamUrlForResolution(encM3u8, curRes);
                            const sM3u8Res = await realFetch(sM3u8Url);
                            if (sM3u8Res.status == 200) {
                                const mText = await sM3u8Res.text();
                                if (mText) {
                                    if (pType == FallbackPlayerType) fallbackM3u8 = mText;
                                    if ((!mText.includes(AdSignifier) && (SimulatedAdsDepth == 0 || pIdx >= SimulatedAdsDepth - 1)) || (!fallbackM3u8 && pIdx >= BackupPlayerTypes.length - 1) || (startIndex > 0)) {
                                        backupM3u8 = mText; break;
                                    }
                                }
                            }
                        } catch (err) {}
                    }
                    streamInfo.BackupEncodingsM3U8Cache[pType] = null;
                    break;
                }
            }
            if (!backupM3u8 && fallbackM3u8) backupM3u8 = fallbackM3u8;
            if (backupM3u8) textStr = backupM3u8;
            const stripHevc = isHevc && streamInfo.ModifiedM3U8;
            if (IsAdStrippingEnabled || stripHevc) textStr = stripAdSegments(textStr, stripHevc, streamInfo);
        } else if (streamInfo.IsShowingAd) {
            streamInfo.IsShowingAd = false; streamInfo.IsStrippingAdSegments = false; streamInfo.NumStrippedAdSegments = 0; streamInfo.ActiveBackupPlayerType = null;
            if (streamInfo.IsUsingModifiedM3U8 || ReloadPlayerAfterAd) {
                streamInfo.IsUsingModifiedM3U8 = false; streamInfo.LastPlayerReload = Date.now(); postMessage({ key: 'ReloadPlayer' });
            } else { postMessage({ key: 'PauseResumePlayer' }); }
        }
        postMessage({ key: 'UpdateAdBlockBanner', isMidroll: streamInfo.IsMidroll, hasAds: streamInfo.IsShowingAd, isStrippingAdSegments: streamInfo.IsStrippingAdSegments, numStrippedAdSegments: streamInfo.NumStrippedAdSegments });
        return textStr;
    }
    function parseAttributes(str) {
        return Object.fromEntries(str.split(/(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/).filter(Boolean).map(x => {
            const idx = x.indexOf('=');
            const key = x.substring(0, idx);
            const val = x.substring(idx + 1);
            const num = Number(val);
            return [key, Number.isNaN(num) ? val.startsWith('"') ? JSON.parse(val) : val : num];
        }));
    }
    function getAccessToken(channelName, playerType) {
        return gqlRequest({
            operationName: 'PlaybackAccessToken',
            variables: { isLive: true, login: channelName, isVod: false, vodID: "", playerType: playerType, platform: playerType == 'autoplay' ? 'android' : 'web' },
            extensions: { persistedQuery: { version:1, sha256Hash:"ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9" } }
        }, playerType);
    }
    function gqlRequest(body, playerType) {
        if (!GQLDeviceID) {
            const dchars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            GQLDeviceID = '';
            for (let i = 0; i < 32; i++) GQLDeviceID += dchars.charAt(Math.floor(Math.random() * dchars.length));
        }
        let headers = { 'Client-ID': ClientID, 'X-Device-Id': GQLDeviceID, 'Authorization': AuthorizationHeader, ...(ClientIntegrityHeader && {'Client-Integrity': ClientIntegrityHeader}), ...(ClientVersion && {'Client-Version': ClientVersion}), ...(ClientSession && {'Client-Session-Id': ClientSession}) };
        return new Promise((resolve, reject) => {
            const rid = Math.random().toString(36).substring(2, 15);
            pendingFetchRequests.set(rid, { resolve, reject });
            postMessage({ key: 'FetchRequest', value: { id: rid, url: 'https://gql.twitch.tv/gql', options: { method: 'POST', body: JSON.stringify(body), headers } } });
        });
    }
    let playerForMonitoringBuffering = null;
    const playerBufferState = { position: 0, bufferedPosition: 0, bufferDuration: 0, numSame: 0, lastFixTime: 0, isLive: true };
    function monitorPlayerBuffering() {
        if (playerForMonitoringBuffering) {
            try {
                const player = playerForMonitoringBuffering.player;
                const state = playerForMonitoringBuffering.state;
                if (!player.core) { playerForMonitoringBuffering = null; }
                else if (state.props?.content?.type === 'live' && !player.isPaused() && !player.getHTMLVideoElement()?.ended && playerBufferState.lastFixTime <= Date.now() - PlayerBufferingMinRepeatDelay && !isActivelyStrippingAds) {
                    const pos = player.core?.state?.position;
                    const bPos = player.core?.state?.bufferedPosition;
                    const bDur = player.getBufferDuration();
                    if (pos > 5 && (playerBufferState.position == pos || bDur < PlayerBufferingDangerZone) && playerBufferState.bufferedPosition == bPos && playerBufferState.bufferDuration >= bDur && (pos != 0 || bPos != 0 || bDur != 0)) {
                        playerBufferState.numSame++;
                        if (playerBufferState.numSame == PlayerBufferingSameStateCount) {
                            doTwitchPlayerTask(!PlayerBufferingDoPlayerReload, PlayerBufferingDoPlayerReload);
                            playerBufferState.lastFixTime = Date.now();
                        }
                    } else { playerBufferState.numSame = 0; }
                    playerBufferState.position = pos; playerBufferState.bufferedPosition = bPos; playerBufferState.bufferDuration = bDur;
                }
            } catch (err) { playerForMonitoringBuffering = null; }
        }
        if (!playerForMonitoringBuffering) {
            const pAndS = getPlayerAndState();
            if (pAndS?.player && pAndS?.state) playerForMonitoringBuffering = { player: pAndS.player, state: pAndS.state };
        }
        playerBufferState.isLive = playerForMonitoringBuffering?.state?.props?.content?.type === 'live';
        setTimeout(monitorPlayerBuffering, PlayerBufferingDelay);
    }
    function updateAdblockBanner(data) {
        isActivelyStrippingAds = data.isStrippingAdSegments;
        // Visual banner logic removed to keep UI clean.
    }
    function getPlayerAndState() {
        function findReactNode(root, constraint) {
            if (root.stateNode && constraint(root.stateNode)) return root.stateNode;
            let node = root.child;
            while (node) {
                const res = findReactNode(node, constraint);
                if (res) return res;
                node = node.sibling;
            }
            return null;
        }
        let reactRootNode = null;
        const rootNode = document.querySelector('#root');
        if (rootNode) {
            if (rootNode._reactRootContainer?._internalRoot?.current) { reactRootNode = rootNode._reactRootContainer._internalRoot.current; }
            else {
                const cName = Object.keys(rootNode).find(x => x.startsWith('__reactContainer'));
                if (cName) reactRootNode = rootNode[cName];
            }
        }
        if (!reactRootNode) return null;
        let player = findReactNode(reactRootNode, n => n.setPlayerActive && n.props?.mediaPlayerInstance);
        player = player?.props?.mediaPlayerInstance ? player.props.mediaPlayerInstance : null;
        const pState = findReactNode(reactRootNode, n => n.setSrc && n.setInitialPlaybackSettings);
        return { player: player, state: pState };
    }
    function doTwitchPlayerTask(isPausePlay, isReload) {
        const pAndS = getPlayerAndState();
        if (!pAndS?.player || !pAndS?.state || pAndS.player.isPaused() || pAndS.player.core?.paused) return;
        if (isPausePlay) { pAndS.player.pause(); pAndS.player.play(); return; }
        if (isReload) {
            const lsKeys = ['video-quality', 'video-muted', 'volume'];
            let cachedLS = {};
            try { lsKeys.forEach(k => cachedLS[k] = localStorage.getItem(k)); } catch {}
            pAndS.state.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
            postTwitchWorkerMessage('TriggeredPlayerReload');
            pAndS.player.play();
            if (localStorageHookFailed) {
                setTimeout(() => { try { Object.keys(cachedLS).forEach(k => { if (cachedLS[k]) localStorage.setItem(k, cachedLS[k]); }); } catch {} }, 3000);
            }
        }
    }
    window.reloadTwitchPlayer = () => { doTwitchPlayerTask(false, true); };
    function postTwitchWorkerMessage(key, value) { twitchWorkers.forEach(w => w.postMessage({key, value})); }
    async function handleWorkerFetchRequest(fetchRequest) {
        try {
            const res = await window.realFetch(fetchRequest.url, fetchRequest.options);
            return { id: fetchRequest.id, status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), body: await res.text() };
        } catch (error) { return { id: fetchRequest.id, error: error.message }; }
    }
    function hookFetch() {
        const realFetch = window.fetch;
        window.realFetch = realFetch;
        window.fetch = function(url, init) {
            if (typeof url === 'string' && url.includes('gql')) {
                let dId = init.headers['X-Device-Id'] || init.headers['Device-ID'];
                if (dId && GQLDeviceID != dId) postTwitchWorkerMessage('UpdateDeviceId', GQLDeviceID = dId);
                if (init.headers['Client-Version'] && init.headers['Client-Version'] !== ClientVersion) postTwitchWorkerMessage('UpdateClientVersion', ClientVersion = init.headers['Client-Version']);
                if (init.headers['Client-Session-Id'] && init.headers['Client-Session-Id'] !== ClientSession) postTwitchWorkerMessage('UpdateClientSession', ClientSession = init.headers['Client-Session-Id']);
                if (init.headers['Client-Integrity'] && init.headers['Client-Integrity'] !== ClientIntegrityHeader) postTwitchWorkerMessage('UpdateClientIntegrityHeader', ClientIntegrityHeader = init.headers['Client-Integrity']);
                if (init.headers['Authorization'] && init.headers['Authorization'] !== AuthorizationHeader) postTwitchWorkerMessage('UpdateAuthorizationHeader', AuthorizationHeader = init.headers['Authorization']);
                if (ForceAccessTokenPlayerType && typeof init.body === 'string' && init.body.includes('PlaybackAccessToken')) {
                    const newBody = JSON.parse(init.body);
                    const updateBody = (b) => { if (b?.variables?.playerType && b.variables.playerType !== ForceAccessTokenPlayerType) b.variables.playerType = ForceAccessTokenPlayerType; };
                    Array.isArray(newBody) ? newBody.forEach(updateBody) : updateBody(newBody);
                    init.body = JSON.stringify(newBody);
                }
                if (init && typeof init.body === 'string' && init.body.includes('PlaybackAccessToken') && init.body.includes('picture-by-picture')) init.body = '';
            }
            return realFetch.apply(this, arguments);
        };
    }
    function onContentLoaded() {
        try { Object.defineProperty(document, 'visibilityState', { get() { return 'visible'; } }); } catch{}
        let hidden = document.__lookupGetter__('hidden'), webkitHidden = document.__lookupGetter__('webkitHidden');
        try { Object.defineProperty(document, 'hidden', { get() { return false; } }); } catch{}
        const block = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
        const visibilityChange = e => {
            if (typeof chrome !== 'undefined') {
                const vids = document.getElementsByTagName('video');
                if (vids.length > 0) {
                    if (hidden?.apply(document) === true || webkitHidden?.apply(document) === true) {} 
                    else if (!vids[0].ended && vids[0].paused && vids[0].muted) vids[0].play();
                }
            }
            block(e);
        };
        document.addEventListener('visibilitychange', visibilityChange, true);
        document.addEventListener('webkitvisibilitychange', visibilityChange, true);
        document.addEventListener('mozvisibilitychange', visibilityChange, true);
        document.addEventListener('hasFocus', block, true);
        try {
            const key = /Firefox/.test(navigator.userAgent) ? 'mozHidden' : 'webkitHidden';
            Object.defineProperty(document, key, { get() { return false; } });
        } catch{}
        try {
            const keys = ['video-quality', 'video-muted', 'volume', 'lowLatencyModeEnabled', 'persistenceEnabled'];
            const cached = new Map();
            keys.forEach(k => cached.set(k, localStorage.getItem(k)));
            const realSet = localStorage.setItem;
            localStorage.setItem = function(k, v) { if (cached.has(k)) cached.set(k, v); realSet.apply(this, arguments); };
            const realGet = localStorage.getItem;
            localStorage.getItem = function(k) { return cached.has(k) ? cached.get(k) : realGet.apply(this, arguments); };
            if (!localStorage.getItem.toString().includes('cached')) localStorageHookFailed = true;
        } catch (err) { localStorageHookFailed = true; }
    }
    declareOptions(window);
    hookWindowWorker();
    hookFetch();
    if (PlayerBufferingFix) monitorPlayerBuffering();
    if (document.readyState === "complete" || document.readyState === "interactive") onContentLoaded();
    else window.addEventListener("DOMContentLoaded", onContentLoaded);
    window.simulateAds = (depth) => { if (depth !== undefined) postTwitchWorkerMessage('SimulateAds', depth); };
    window.allSegmentsAreAdSegments = () => postTwitchWorkerMessage('AllSegmentsAreAdSegments');
})();
