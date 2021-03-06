/**
 * @file text-tracks.js
 */
import window from 'global/window';
import videojs from 'video.js';

/**
 * Create captions text tracks on video.js if they do not exist
 *
 * @param {Object} inbandTextTracks a reference to current inbandTextTracks
 * @param {Object} tech the video.js tech
 * @param {Object} captionStream the caption stream to create
 * @private
 */
export const createCaptionsTrackIfNotExists = function(inbandTextTracks, tech, captionStream) {
  if (!inbandTextTracks[captionStream]) {
    tech.trigger({type: 'usage', name: 'hls-608'});
    let track = tech.textTracks().getTrackById(captionStream);

    if (track) {
      // Resuse an existing track with a CC# id because this was
      // very likely created by videojs-contrib-hls from information
      // in the m3u8 for us to use
      inbandTextTracks[captionStream] = track;
    } else {
      // Otherwise, create a track with the default `CC#` label and
      // without a language
      inbandTextTracks[captionStream] = tech.addRemoteTextTrack({
        kind: 'captions',
        id: captionStream,
        label: captionStream
      }, false).track;
    }
  }
};

/**
 * Add caption text track data to a source handler given an array of captions
 *
 * @param {Object}
 *   @param {Object} inbandTextTracks the inband text tracks
 *   @param {Number} timestampOffset the timestamp offset of the source buffer
 *   @param {Array} captionArray an array of caption data
 * @private
 */
export const addCaptionData = function({
  inbandTextTracks,
  captionArray,
  timestampOffset
}) {
  if (!captionArray) {
    return;
  }

  const Cue = window.WebKitDataCue || window.VTTCue;

  captionArray.forEach((caption) => {
    const track = caption.stream;

    inbandTextTracks[track].addCue(
      new Cue(
        caption.startTime + timestampOffset,
        caption.endTime + timestampOffset,
        caption.text
      ));
  });
};

/**
 * Define properties on a cue for backwards compatability,
 * but warn the user that the way that they are using it
 * is depricated and will be removed at a later date.
 *
 * @param {Cue} cue the cue to add the properties on
 * @private
 */
const deprecateOldCue = function(cue) {
  Object.defineProperties(cue.frame, {
    id: {
      get() {
        videojs.log.warn(
          'cue.frame.id is deprecated. Use cue.value.key instead.'
        );
        return cue.value.key;
      }
    },
    value: {
      get() {
        videojs.log.warn(
          'cue.frame.value is deprecated. Use cue.value.data instead.'
        );
        return cue.value.data;
      }
    },
    privateData: {
      get() {
        videojs.log.warn(
          'cue.frame.privateData is deprecated. Use cue.value.data instead.'
        );
        return cue.value.data;
      }
    }
  });
};

/**
 * Add metadata text track data to a source handler given an array of metadata
 *
 * @param {Object}
 *   @param {Object} inbandTextTracks the inband text tracks
 *   @param {Array} metadataArray an array of meta data
 *   @param {Number} timestampOffset the timestamp offset of the source buffer
 *   @param {Number} videoDuration the duration of the video
 * @private
 */
export const addMetadata = ({
  inbandTextTracks,
  metadataArray,
  timestampOffset,
  videoDuration
}) => {
  if (!metadataArray) {
    return;
  }

  const Cue = window.WebKitDataCue || window.VTTCue;
  const metadataTrack = inbandTextTracks.metadataTrack_;

  if (!metadataTrack) {
    return;
  }

  metadataArray.forEach((metadata) => {
    let time = metadata.cueTime + timestampOffset;

    // if time isn't a finite number between 0 and Infinity, like NaN,
    // ignore this bit of metadata.
    // This likely occurs when you have an non-timed ID3 tag like TIT2,
    // which is the "Title/Songname/Content description" frame
    if (typeof time !== 'number' || window.isNaN(time) || time < 0 || !(time < Infinity)) {
      return;
    }

    metadata.frames.forEach((frame) => {
      let cue = new Cue(
        time,
        time,
        frame.value || frame.url || frame.data || '');

      cue.frame = frame;
      cue.value = frame;
      deprecateOldCue(cue);

      metadataTrack.addCue(cue);
    });
  });

  if (!metadataTrack.cues || !metadataTrack.cues.length) {
    return;
  }

  // Updating the metadeta cues so that
  // the endTime of each cue is the startTime of the next cue
  // the endTime of last cue is the duration of the video
  let cues = metadataTrack.cues;
  let cuesArray = [];

  // Create a copy of the TextTrackCueList...
  // ...disregarding cues with a falsey value
  for (let i = 0; i < cues.length; i++) {
    if (cues[i]) {
      cuesArray.push(cues[i]);
    }
  }

  // Group cues by their startTime value
  let cuesGroupedByStartTime = cuesArray.reduce((obj, cue) => {
    let timeSlot = obj[cue.startTime] || [];

    timeSlot.push(cue);
    obj[cue.startTime] = timeSlot;

    return obj;
  }, {});

  // Sort startTimes by ascending order
  let sortedStartTimes = Object.keys(cuesGroupedByStartTime)
                               .sort((a, b) => Number(a) - Number(b));

  // Map each cue group's endTime to the next group's startTime
  sortedStartTimes.forEach((startTime, idx) => {
    let cueGroup = cuesGroupedByStartTime[startTime];
    let nextTime = Number(sortedStartTimes[idx + 1]) || videoDuration;

    // Map each cue's endTime the next group's startTime
    cueGroup.forEach((cue) => {
      cue.endTime = nextTime;
    });
  });
};

/**
 * Create metadata text track on video.js if it does not exist
 *
 * @param {Object} inbandTextTracks a reference to current inbandTextTracks
 * @param {String} dispatchType the inband metadata track dispatch type
 * @param {Object} tech the video.js tech
 * @private
 */
export const createMetadataTrackIfNotExists = (inbandTextTracks, dispatchType, tech) => {
  if (inbandTextTracks.metadataTrack_) {
    return;
  }

  inbandTextTracks.metadataTrack_ = tech.addRemoteTextTrack({
    kind: 'metadata',
    label: 'Timed Metadata'
  }, false).track;

  inbandTextTracks.metadataTrack_.inBandMetadataTrackDispatchType = dispatchType;
};

/**
 * Remove cues from a track on video.js.
 *
 * @param {Double} start start of where we should remove the cue
 * @param {Double} end end of where the we should remove the cue
 * @param {Object} track the text track to remove the cues from
 * @private
 */
export const removeCuesFromTrack = function(start, end, track) {
  let i;
  let cue;

  if (!track) {
    return;
  }

  if (!track.cues) {
    return;
  }

  i = track.cues.length;

  while (i--) {
    cue = track.cues[i];

    // Remove any overlapping cue
    if (cue.startTime <= end && cue.endTime >= start) {
      track.removeCue(cue);
    }
  }
};
