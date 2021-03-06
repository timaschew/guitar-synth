gsynth = {};
!function(g){
  /**
   * This creates the audio node
   * and pulls the sound data directly
   * from the instrument and feeds it into
   * the output buffer
   *
   */

  g.SoundOutputBuffer = function(){
    this._setContext();

    if(this.ok()){
      this._createAudioNode();
    }
  }

  g.SoundOutputBuffer.prototype = {

    useInstrument: function(ins){
      this.instrument = ins;
    },

    turnOn: function(){
      this.node && this.node.connect(this.context.destination);
    },

    turnOff: function(){
      this.node && this.node.disconnect();
    },

    destroy: function(){
      this.turnOff();
      this.node = null;
      this.context = null;
    },

    ok: function(){
      return !!(this.context);
    },

    getSampleRate: function(){
      return this.context && this.context.sampleRate;
    },

    _setContext: function(){
      if(!window['AudioContext'] && !window['webkitAudioContext']){ return; }

      try {
        this.context = new (window.AudioContext || window.webkitAudioContext)();
      } catch(e){
        this.context = null;
      }
    },

    _createAudioNode: function(){
      this.node = this.context.createScriptProcessor(1024, 1, 1);

      var self = this;

      this.node.onaudioprocess = function(e){
        var data = e.outputBuffer.getChannelData(0);

        if(!self.instrument){ return; }
        for (var i = 0; i < data.length; i++) {
          data[i] = self.instrument.getSampleData();
        }
      }
    }
  }

}(gsynth);
!function(g){

  /**
   * Each instance of this class represents
   * 1 string on the guitar.  It uses
   * a Karplus-Strong like algorithm to
   * generate plucked string sounding oscillations
   * at the appropriate frequency.
   *
   * The rate of decay is dependent on the frequency
   * and fret number (higher fret, shorter string, faster decay)
   */
  var DECAY_CONSTANT = .99999
    , NO_SOUND_THRESHOLD = 0.1;

  g.PluckedString = function(ops){
    // sample rate varies by hardware, need to pass it
    // in from the WebAudio context:
    this.sampleRate = ops.sampleRate;
    this.setRootNote(ops.rootNote);
  }

  g.PluckedString.prototype = {

    getSampleData: function(){
      if(!this.playing){ return 0; }

      if( this.periodIndex == this.N ){
        this.periodIndex = 0;
      }

      if( this.cumulativeIndex < this.N ){
        this.period[ this.periodIndex ] += (Math.random() - Math.random()) / 4;
      }

      this.current += ( this.period[ this.periodIndex ] - this.current ) * this.decay;
      this.period[ this.periodIndex ] = this.current;
    
      ++this.periodIndex;
      ++this.cumulativeIndex;

      this.decay *= DECAY_CONSTANT;
    
      if( this.decay < NO_SOUND_THRESHOLD ){
        this.stopPlaying();
      }

      return this.current;
    },

    setRootNote: function(rootNote){
      this.rootNote = rootNote;
      this.rootFreq = this._midiToFreq(this.rootNote);

      this._setFrequency(this.rootFreq);

      // the goal of the decay being different by string
      // is that the low notes need to decay faster, otherwise
      // they resonate for a really long time.  But the high
      // notes need to decay slower, otherwise they sound really
      // muted and short.
      //
      // this formula is just from trial and error and based
      // on nothing other than what sounded best to my ear:
      this.stringDecay = (this.rootNote / 80) + .1;
    },

    playNote: function(fret){
      this._setFrequency( this._midiToFreq(fret + this.rootNote) );
      this.playing = true;
    },

    stopPlaying: function(){
      this.playing = false;
    },

    _setFrequency: function(freq){
      this.N = Math.round(this.sampleRate / freq);
      this.period = this._createArrayWithZeros(this.N);

      this.periodIndex = 0;
      this.cumulativeIndex = 0;
      this.decay = this.stringDecay;

      this.current = 0;
    },

    _midiToFreq: function(midi){
      return 440.0 * Math.pow(2, (midi - 69) / 12.0);
    },

    _createArrayWithZeros: function(len){
      var arr = [];
      for(var i=0;i<len;i++){
        arr[i] = 0;
      }
      return arr;
    }

  }

}(gsynth);
!function(g){
  /**
   * The guitar instantiates
   * the right strings, each in the right
   * tuning and will sum the sample
   * data across all strings during playback,
   */

  var DEFAULT_GAIN = 4;

  g.Guitar = function(ops){
    ops = ops || {};

    this.sampleRate = ops.sampleRate;
    this.gain = ops.gain || DEFAULT_GAIN;
    this.tuning = ops.tuning;

    this._createStrings( this.tuning );
  }

  g.Guitar.prototype = {

    setTuning: function(tuning){
      if(!this.strings){ this._createStrings(tuning); }

      for(var i=0;i<this.strings.length;i++){
        this.strings[i].setRootNote(tuning[i]);
      }
    },

    playNotes: function(notes){
      if(!notes || notes.length === 0){
        return this.stopPlaying();
      }

      for(var i=0;i<notes.length;i++){
        this.strings[ notes[i].str ].playNote( notes[i].fret );
      }
    },

    getSampleData: function(){
      var current = 0;

      for(var i=0;i<this.numStrings;i++){
        current += this.strings[i].getSampleData();
      }

      return (current / this.numStrings) * this.gain;
    },

    stopPlaying: function(){
      for(var i=0;i<this.numStrings;i++){
        this.strings[i].stopPlaying();
      }
    },

    destroy: function(){
      this.stopPlaying();
    },

    _createStrings: function(tuning){
      if(this.strings){ this._destroyStrings(); }

      this.numStrings = tuning.length;
      this.strings = [];

      for(var i=0;i<this.numStrings;i++){
        this.strings[i] = new g.PluckedString({
          sampleRate: this.sampleRate,
          rootNote: tuning[i]
        });
      }
    }

  }

}(gsynth);
!function(g){
  /**
   * The main interface for our WebAudio
   * Guitar Synth.
   */

  var STANDARD_TUNING = [64,59,55,50,45,40];

  g.GuitarSynthWebAudio = function(){
    // First try to create the SoundOutputBuffer
    // and make sure we can use WebAudio API
    // if not, return false and don't instantiate
    // anything:
    if(!this.isSupported()){
      return false;
    }

    this.instrument = new g.Guitar({
      tuning: STANDARD_TUNING,
      sampleRate: this.buffer.getSampleRate()
    });

    this.buffer.useInstrument( this.instrument );
  }

  g.GuitarSynthWebAudio.prototype = {

    turnOn: function(){
      this.buffer.turnOn();
    },

    turnOff: function(){
      this.buffer.turnOff();
    },

    playNotes: function(notes){
      this.instrument.playNotes(notes);
      this.turnOn();
    },

    setTuning: function(tuning){
      this.instrument.setTuning(tuning);
    },

    isSupported: function(){
      if(!this.buffer){
        this.buffer = new g.SoundOutputBuffer();
      }

      return this.buffer.ok();
    },

    destroy: function(){
      this.turnOff();

      this.buffer.destroy();
      this.instrument.destroy();
    }
  }

}(gsynth);
!function(g){
  /**
   * This is the main facade
   * that we expose as the main interface.
   *
   * It makes the decision which playback method
   * to use (WebAudio vs. Flash) and encapsulates all
   * of that.
   */

  g.GuitarSynth = function(ops){
    this._initBestPlaybackMethod(ops);
  }

  g.GuitarSynth.prototype = {

    turnOn: function(){
      this.playback && this.playback.turnOn();
    },

    turnOff: function(){
      this.playback && this.playback.turnOff();
    },

    playNotes: function(notes){
      this.playback && this.playback.playNotes(notes);
    },

    setTuning: function(tuning){
      this.playback && this.playback.setTuning(tuning);
    },

    destroy: function(){
      this.playback && this.playback.destroy();
    },

    /**
     * check that we have a playback method
     * and that playback method is supported
     *
     * @returns {Boolean}
     * @api public
     */
    ok: function(){
      return this.playback && this.playback.isSupported();
    },

    /**
     * we only have 2 options right now, WebAudio is preferred
     * and then we fall back to Flash where WebAudio isn't available
     *
     * @param {Object} ops
     * @api private
     */
    _initBestPlaybackMethod: function(ops){
      ops = ops || {};

      // first try WebAudio API, don't try it if it's
      // iOS device and the noiOS op was passed in:
      this._initWebAudio(ops);

      // if we couldn't instantiate any playback method,
      // set playback to null:
      if(!this.playback.isSupported()){
        this.playback = null;
      }
    },

    _initWebAudio: function(ops){
      if(this.playback && this.playback.isSupported()){
        return;
      }

      if(ops.noiOS && iOS()){
        return;
      }

      if(ops.noWebAudio){
        return;
      }

      this.playbackMethod = 'webaudio';
      this.playback = new g.GuitarSynthWebAudio(ops);
    }
  }

  function iOS(){
    return !!(window.navigator.userAgent.match(/iPod|iPad|iPhone|iOS/g));
  }

}(gsynth);
