import videojs from 'video.js';

const transmuxQueue = [];
let currentTransmux;

export const handleData_ = (event, transmuxedData, callback) => {
  const {
    type,
    initSegment,
    captions,
    captionStreams,
    metadata,
    videoFrameDtsTime
  } = event.data.segment;

  transmuxedData.buffer.push({
    captions,
    captionStreams,
    metadata
  });

  // right now, boxes will come back from partial transmuxer, data from full
  const boxes = event.data.segment.boxes || {
    data: event.data.segment.data
  };

  const result = {
    type,
    // cast ArrayBuffer to TypedArray
    data: new Uint8Array(
      boxes.data,
      boxes.data.byteOffset,
      boxes.data.byteLength
    ),
    initSegment: new Uint8Array(
      initSegment.data,
      initSegment.byteOffset,
      initSegment.byteLength
    )
  };

  if (videoFrameDtsTime) {
    result.videoFrameDtsTime = videoFrameDtsTime;
  }

  callback(result);
};

export const handleDone_ = ({
  event,
  transmuxedData,
  onId3,
  onCaptions,
  callback
}) => {
  // all buffers should have been flushed from the muxer, so start processing anything we
  // have received
  let sortedSegments = {
    captions: [],
    gopInfo: transmuxedData.gopInfo,
    videoTimingInfo: transmuxedData.videoTimingInfo,
    audioTimingInfo: transmuxedData.audioTimingInfo,
    captionStreams: {}
  };
  const buffer = transmuxedData.buffer;
  let metadata = [];
  let captions = [];
  let captionStreams = [];

  transmuxedData.buffer = [];

  // Sort segments into separate video/audio arrays and
  // keep track of their total byte lengths
  sortedSegments = buffer.reduce((segmentObj, segment) => {
    // Gather any captions into a single array
    if (segment.captions) {
      captions = captions.concat(segment.captions);
    }

    // Gather any metadata into a single array
    if (segment.metadata) {
      metadata = metadata.concat(segment.metadata);
    }

    if (segment.captionStreams) {
      captionStreams = videojs.mergeOptions(captionStreams, segment.captionStreams);
    }

    return segmentObj;
  }, sortedSegments);

  if (metadata && metadata.length) {
    onId3(metadata, metadata.dispatchType);
  }
  if (captions && captions.length) {
    onCaptions(captions, captionStreams);
  }

  callback(sortedSegments);
};

export const handleGopInfo_ = (event, transmuxedData) => {
  transmuxedData.gopInfo = event.data.gopInfo;
};

export const processTransmux = ({
  transmuxer,
  bytes,
  audioAppendStart,
  gopsToAlignWith,
  isPartial,
  onData,
  onTrackInfo,
  onAudioTimingInfo,
  onVideoTimingInfo,
  onId3,
  onCaptions,
  onDone
}) => {
  const transmuxedData = {
    isPartial,
    buffer: []
  };

  const handleMessage = (event) => {
    if (event.data.action === 'data') {
      handleData_(event, transmuxedData, onData);
    }
    if (event.data.action === 'trackinfo') {
      onTrackInfo(event.data.trackInfo);
    }
    if (event.data.action === 'gopInfo') {
      handleGopInfo_(event, transmuxedData);
    }
    if (event.data.action === 'audioTimingInfo') {
      onAudioTimingInfo(event.data.audioTimingInfo);
    }
    if (event.data.action === 'videoTimingInfo') {
      onVideoTimingInfo(event.data.videoTimingInfo);
    }
    // only used for partial transmuxer, full transmuxer will handle on done
    if (event.data.action === 'id3Frame') {
      onId3([event.data.id3Frame], event.data.id3Frame.dispatchType);
    }

    // wait for the transmuxed event since we may have audio and video
    if (event.data.type !== 'transmuxed') {
      return;
    }

    transmuxer.removeEventListener('message', handleMessage);
    handleDone_({
      event,
      transmuxedData,
      onId3,
      onCaptions,
      callback: onDone
    });

    /* eslint-disable no-use-before-define */
    dequeue();
    /* eslint-enable */
  };

  transmuxer.addEventListener('message', handleMessage);

  if (audioAppendStart) {
    transmuxer.postMessage({
      action: 'setAudioAppendStart',
      appendStart: audioAppendStart
    });
  }

  if (gopsToAlignWith) {
    transmuxer.postMessage({
      action: 'alignGopsWith',
      gopsToAlignWith
    });
  }

  if (bytes.byteLength) {
    const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
    const byteOffset = bytes instanceof ArrayBuffer ? 0 : bytes.byteOffset;

    transmuxer.postMessage({
      action: 'push',
      // Send the typed-array of data as an ArrayBuffer so that
      // it can be sent as a "Transferable" and avoid the costly
      // memory copy
      data: buffer,
      // To recreate the original typed-array, we need information
      // about what portion of the ArrayBuffer it was a view into
      byteOffset,
      byteLength: bytes.byteLength
    },
    [ buffer ]);
  }

  // even if we didn't push any bytes, we have to make sure we flush in case we reached
  // the end of the segment
  transmuxer.postMessage({ action: isPartial ? 'partialFlush' : 'flush' });
};

export const dequeue = () => {
  currentTransmux = null;
  if (transmuxQueue.length) {
    currentTransmux = transmuxQueue.shift();
    if (typeof currentTransmux === 'function') {
      currentTransmux();
    } else {
      processTransmux(currentTransmux);
    }
  }
};

export const processAction = (transmuxer, action) => {
  transmuxer.postMessage({ action });
  dequeue();
};

export const enqueueAction = (action, transmuxer) => {
  if (!currentTransmux) {
    currentTransmux = action;
    processAction(transmuxer, action);
    return;
  }
  transmuxQueue.push(processAction.bind(null, transmuxer, action));
};

export const reset = (transmuxer) => {
  enqueueAction('reset', transmuxer);
};

export const endTimeline = (transmuxer) => {
  enqueueAction('endTimeline', transmuxer);
};

export const transmux = (options) => {
  if (!currentTransmux) {
    currentTransmux = options;
    processTransmux(options);
    return;
  }
  transmuxQueue.push(options);
};

export default {
  reset,
  endTimeline,
  transmux
};