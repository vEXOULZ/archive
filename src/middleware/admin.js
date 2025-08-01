const vod = require("./vod");
const axios = require("axios");
const twitch = require("./twitch");
const kick = require("./kick");
const fs = require("fs");
const path = require("path");
const config = require("../../config/config.json");
const drive = require("./drive");
const emotes = require("./emotes");
const dayjs = require("dayjs");
const duration = require("dayjs/plugin/duration");
const ffmpeg = require("./ffmpeg");
dayjs.extend(duration);

module.exports.verify = function (app) {
  return async function (req, res, next) {
    if (!req.headers["authorization"]) {
      res.status(403).json({ error: true, msg: "Missing auth key" });
      return;
    }

    const authKey = req.headers.authorization.split(" ")[1];
    const key = app.get("ADMIN_API_KEY");

    if (key !== authKey) {
      res.status(403).json({ error: true, msg: "Not authorized" });
      return;
    }
    next();
  };
};

module.exports.generateVod = function (app) {
  return async function (req, res, next) {
    let { vodId, type, platform, path, m3u8 } = req.body;
    if (!vodId) return res.status(400).json({ error: true, msg: "No VodId" });
    if (!type) return res.status(400).json({ error: true, msg: "No type" });
    if (!platform)
      return res.status(400).json({ error: true, msg: "No platform" });

    const exists = await app
      .service("vods")
      .get(vodId)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      return res.status(400).json({ error: true, msg: "Vod data already exists" });
    }

    if (platform === "twitch") {
      const vodData = await twitch.getVodData(vodId);
      if (!vodData)
        return res.status(404).json({ error: true, msg: "No Vod Data" });

      if (vodData.user_id !== config.twitch.id)
        return res.status(400).json({
          error: true,
          msg: "This vod belongs to another channel..",
        });

      await app
        .service("vods")
        .create({
          id: vodData.id,
          title: vodData.title,
          createdAt: vodData.created_at,
          duration: dayjs
            .duration(`PT${vodData.duration.toUpperCase()}`)
            .format("HH:mm:ss"),
          stream_id: vodData.stream_id,
          platform: "twitch",
        })
        .then(() => {
          console.info(
            `Created twitch vod ${vodData.id} for ${vodData.user_name}`
          );
        })
        .catch((e) => {
          console.error(e);
        });

      res.status(200).json({ error: false, msg: "Vod Data Created.." });
      emotes.save(vodId, app);

    } else if (platform === "kick") {
      const vodData = await kick.getVod(app, config.kick.username, vodId);
      if (!vodData)
        return res.status(404).json({ error: true, msg: "No Vod Data" });

      if (vodData.channel_id.toString() !== config.kick.id)
        return res.status(400).json({
          error: true,
          msg: "This vod belongs to another channel..",
        });

      await app
        .service("vods")
        .create({
          id: vodData.id.toString(),
          title: vodData.session_title,
          createdAt: vodData.start_time,
          duration: dayjs
            .duration(vodData.duration, "milliseconds")
            .format("HH:mm:ss"),
          stream_id: vodData.video.uuid,
          platform: "kick",
        })
        .then(() => {
          console.info(
            `Created kick vod ${vodData.id} for ${config.kick.username}`
          );
        })
        .catch((e) => {
          console.error(e);
        });
      res.status(200).json({ error: false, msg: "Vod Data Created.." });

    }
  };
};

module.exports.refreshToken = function (app) {
  return async function (req, res, next) {
    if (!req.query.code) return res.status(400).json({ error: true, msg: "No code" });
    if (!req.query.scope) return res.status(400).json({ error: true, msg: "No scope" });

    let code = req.query.code;
    let scope = req.query.scope;

    let scopeStr;
    if (scope.split(' ')[0].includes('drive')) scopeStr = 'drive';
    else if (scope.split(' ')[0].includes('youtube')) scopeStr = 'youtube';
    else return res.status(400).json({ error: true, msg: "Unrecognized scope" });

    const data = await axios({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: {
      },
      data: {
        code: code,
        client_id: config.google.client_id,
        client_secret: config.google.client_secret,
        redirect_uri: config.google.redirect_url,
        grant_type: "authorization_code",
      },
    })
    .then((response) => {
      return response;
    })
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });

    if (data === null) return res.status(400).json({ error: true, msg: "Bad request" });
    if (data.status != 200) return res.status(400).json({ error: true, msg: `Request ${data.status}` });

    if (scopeStr === 'youtube') {
      config.youtube.auth = data.data;
      let oauth2Client = app.get("ytOauth2Client");
      oauth2Client.setCredentials(config.youtube.auth);
    } else if (scopeStr === 'drive') {
      config.drive.auth = data.data;
      let oauth2Client = app.get("driveOauth2Client");
      oauth2Client.setCredentials(config.drive.auth);
    }

    fs.writeFile(path.resolve(__dirname, "../../config/config.json"), JSON.stringify(config, null, 4), (err) => {
      if (err) return console.error(err);
      res.status(200).json({ error: false, msg: `Set ${scopeStr} refresh token` });
      console.info(`Set ${scopeStr} refresh token`);
    });

  };
};



module.exports.download = function (app) {
  return async function (req, res, next) {
    let { vodId, type, platform, path, m3u8, startPart, endPart } = req.body;
    if (!vodId) return res.status(400).json({ error: true, msg: "No VodId" });
    if (!type) return res.status(400).json({ error: true, msg: "No type" });
    if (!platform)
      return res.status(400).json({ error: true, msg: "No platform" });

    const exists = await app
      .service("vods")
      .get(vodId)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      res.status(200).json({ error: false, msg: "Starting download.." });
      emotes.save(vodId, app);
      if (m3u8) {
        await kick.downloadHLS(vodId, app, m3u8);
        return;
      }
      const vodPath = await vod.upload(vodId, app, path, type, startPart, endPart);
      // if (vodPath) fs.unlinkSync(vodPath);
      return;
    } else {
      return res.status(404).json({ error: false, msg: "No Vod Data" });
    }
  };
};

module.exports.hlsDownload = function (app) {
  return async function (req, res, next) {
    const { vodId } = req.body;
    if (!vodId) return res.status(400).json({ error: true, msg: "No VodId" });

    const exists = await app
      .service("vods")
      .get(vodId)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      console.info(`Start Vod download: ${vodId}`);
      vod.download(vodId, app);
      console.info(`Start Logs download: ${vodId}`);
      vod.downloadLogs(vodId, app);
      res.status(200).json({ error: false, msg: "Starting download.." });
      return;
    }

    const vodData = await twitch.getVodData(vodId);
    if (!vodData)
      return res.status(404).json({ error: true, msg: "No Vod Data" });

    if (vodData.user_id !== config.twitch.id)
      return res.status(400).json({
        error: true,
        msg: "This vod belongs to another channel..",
      });

    await app
      .service("vods")
      .create({
        id: vodData.id,
        title: vodData.title,
        createdAt: vodData.created_at,
        duration: dayjs
          .duration(`PT${vodData.duration.toUpperCase()}`)
          .format("HH:mm:ss"),
        stream_id: vodData.stream_id,
        platform: "twitch",
      })
      .then(() => {
        console.info(`Created vod ${vodData.id} for ${vodData.user_name}`);
      })
      .catch((e) => {
        console.error(e);
      });

    console.info(`Start Vod download: ${vodId}`);
    vod.download(vodId, app);
    console.info(`Start Logs download: ${vodId}`);
    vod.downloadLogs(vodId, app);
    res.status(200).json({ error: false, msg: "Starting download.." });
  };
};

module.exports.logs = function (app) {
  return async function (req, res, next) {
    const { vodId, platform } = req.body;
    if (!vodId) return res.status(400).json({ error: true, msg: "No VodId" });
    if (!platform)
      return res.status(400).json({ error: true, msg: "No Platform" });

    let total;
    app
      .service("logs")
      .find({
        query: {
          $limit: 0,
          vod_id: vodId,
        },
      })
      .then((data) => {
        total = data.total;
      })
      .catch((e) => {
        console.error(e);
      });

    if (total > 1)
      return res.status(400).json({
        error: true,
        msg: `Logs already exist for ${vodId}`,
      });

    if (platform === "twitch") {
      vod.getLogs(vodId, app);
      res.status(200).json({ error: false, msg: "Getting logs.." });
    } else if (platform === "kick") {
      const vodData = await kick.getVod(app, config.kick.username, vodId);
      kick.downloadLogs(
        vodId,
        app,
        dayjs.utc(vodData.start_time).toISOString(),
        vodData.duration
      );
      res.status(200).json({ error: false, msg: "Getting logs.." });
    } else {
      res.status(400).json({ error: false, msg: "Platform not supported.." });
    }
  };
};

module.exports.manualLogs = function (app) {
  return async function (req, res, next) {
    const { vodId, path } = req.body;
    if (!vodId) return res.status(400).json({ error: true, msg: "No VodId" });
    if (!path) return res.status(400).json({ error: true, msg: "No Path" });

    vod.manualLogs(path, vodId, app);
    res.status(200).json({ error: false, msg: "Getting logs.." });
  };
};

module.exports.createVod = function (app) {
  return async function (req, res, next) {
    const { vodId, title, createdAt, duration, drive, platform } = req.body;
    if (vodId == null)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter: Vod id" });
    if (!title)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter: Title" });
    if (!createdAt)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter: CreatedAt" });
    if (!duration)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter: Duration" });
    if (!platform)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter: platform" });

    const exists = await app
      .service("vods")
      .get(vodId)
      .then(() => true)
      .catch(() => false);

    if (exists)
      return res
        .status(400)
        .json({ error: true, msg: `${vodId} already exists!` });

    await app
      .service("vods")
      .create({
        id: vodId,
        title: title,
        createdAt: createdAt,
        duration: duration,
        drive: drive ? [drive] : [],
        platform: platform,
      })
      .then(() => {
        console.info(`Created vod ${vodId}`);
        res.status(200).json({ error: false, msg: `${vodId} Created!` });
      })
      .catch((e) => {
        console.error(e);
        res
          .status(200)
          .json({ error: true, msg: `Failed to create ${vodId}!` });
      });
  };
};

module.exports.deleteVod = function (app) {
  return async function (req, res, next) {
    const { vodId } = req.body;
    if (vodId == null)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter: Vod id" });

    res.status(200).json({ error: false, msg: "Starting deletion process.." });

    await app
      .service("vods")
      .remove(vodId)
      .then(() => {
        console.info(`Deleted vod for ${vodId}`);
      })
      .catch((e) => {
        console.error(e);
      });

    await app
      .service("logs")
      .remove(null, {
        query: {
          vod_id: vodId,
        },
      })
      .then(() => {
        console.info(`Deleted logs for ${vodId}`);
      })
      .catch((e) => {
        console.error(e);
      });

    await app
      .service("emotes")
      .remove(null, {
        query: {
          vod_id: vodId,
        },
      })
      .then(() => {
        console.info(`Deleted emotes for ${vodId}`);
      })
      .catch((e) => {
        console.error(e);
      });

    await app
      .service("games")
      .remove(null, {
        query: {
          vod_id: vodId,
        },
      })
      .then(() => {
        console.info(`Deleted games for ${vodId}`);
      })
      .catch((e) => {
        console.error(e);
      });
  };
};

module.exports.reUploadPart = function (app) {
  return async function (req, res, next) {
    const { vodId, part, type } = req.body;
    if (!vodId) return res.status(400).json({ error: true, msg: "No vod id" });
    if (!part) return res.status(400).json({ error: true, msg: "No part" });
    if (!type) return res.status(400).json({ error: true, msg: "No type" });

    res.status(200).json({
      error: false,
      msg: `Reuploading ${vodId} Vod Part ${part}`,
    });

    const vod_data = await app
      .service("vods")
      .get(vodId)
      .then((data) => data)
      .catch(() => null);

    let videoPath =
      type === "live"
        ? `${config.livePath}/${config.twitch.username}/${vod_data.stream_id}/${vod_data.stream_id}.mp4`
        : `${config.vodPath}/${vodId}.mp4`;

    if (!(await fileExists(videoPath))) {
      if (config.drive.upload) {
        videoPath = await drive.download(vodId, type, app);
      } else if (type === "vod") {
        videoPath = await vod.mp4Download(vodId);
      } else {
        videoPath = null;
      }
    }

    if (!videoPath)
      return console.error(`Could not find a download source for ${vodId}`);

    await vod.liveUploadPart(
      app,
      vodId,
      videoPath,
      config.youtube.splitDuration * parseInt(part) - 1,
      config.youtube.splitDuration,
      part,
      type
    );
  };
};

module.exports.saveChapters = function (app) {
  return async function (req, res, next) {
    const { vodId, platform } = req.body;
    if (!vodId) return res.status(400).json({ error: true, msg: "No vod id" });
    if (!platform)
      return res.status(400).json({ error: true, msg: "No platform" });

    if (platform === "twitch") {
      const vodData = await twitch.getVodData(vodId);
      if (!vodData)
        return res.status(500).json({
          error: true,
          msg: `Failed to get vod data for ${vodId}`,
        });

      vod.saveChapters(
        vodData.id,
        app,
        dayjs.duration(`PT${vodData.duration.toUpperCase()}`).asSeconds()
      );
      res
        .status(200)
        .json({ error: false, msg: `Saving Chapters for ${vodId}` });
    } else if (platform === "kick") {
      //TODO
      res
        .status(200)
        .json({ error: false, msg: `Saving Chapters for ${vodId}` });
    } else {
      res.status(400).json({ error: true, msg: `Platform not supported..` });
    }
  };
};

module.exports.saveDuration = function (app) {
  return async function (req, res, next) {
    const { vodId, platform } = req.body;
    if (!vodId) return res.status(400).json({ error: true, msg: "No vod id" });
    if (!platform)
      return res.status(400).json({ error: true, msg: "No platform" });

    if (platform === "twitch") {
      const vodData = await twitch.getVodData(vodId);
      if (!vodData)
        return res.status(500).json({
          error: true,
          msg: `Failed to get vod data for ${vodId}`,
        });

      const exists = await app
        .service("vods")
        .get(vodId)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        await app
          .service("vods")
          .patch(vodId, {
            duration: dayjs
              .duration(`PT${vodData.duration.toUpperCase()}`)
              .format("HH:mm:ss"),
          })
          .then(() =>
            res.status(200).json({ error: false, msg: "Saved duration!" })
          )
          .catch(() =>
            res
              .status(500)
              .json({ error: true, msg: "Failed to save duration!" })
          );
        return;
      }
    } else if (platform === "kick") {
      //TODO
      return;
    }

    res.status(404).json({ error: true, msg: "Vod does not exist!" });
  };
};

module.exports.addGame = function (app) {
  return async function (req, res, next) {
    const {
      vod_id,
      start_time,
      end_time,
      video_provider,
      video_id,
      game_id,
      game_name,
      thumbnail_url,
    } = req.body;
    if (vod_id == null)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter vod_id" });
    if (start_time == null)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter: start_time" });
    if (end_time == null)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter: end_time" });
    if (!video_provider)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter: video_provider" });
    if (!video_id)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter: video_id" });
    if (!game_id)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter: game_id" });
    if (!game_name)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter: game_name" });
    if (!thumbnail_url)
      return res
        .status(400)
        .json({ error: true, msg: "Missing parameter: thumbnail_url" });

    const exists = await app
      .service("vods")
      .get(vod_id)
      .then(() => true)
      .catch(() => false);

    if (!exists)
      return res
        .status(400)
        .json({ error: true, msg: `${vod_id} does not exist!` });

    await app
      .service("games")
      .create({
        vodId: vod_id,
        start_time: start_time,
        end_time: end_time,
        video_provider: video_provider,
        video_id: video_id,
        game_id: game_id,
        game_name: game_name,
        thumbnail_url: thumbnail_url,
      })
      .then(() => {
        console.info(`Created ${game_name} in games DB for ${vod_id}`);
        res.status(200).json({
          error: false,
          msg: `Created ${game_name} in games DB for ${vod_id}`,
        });
      })
      .catch((e) => {
        console.error(e);
        res.status(500).json({
          error: true,
          msg: `Failed to create ${game_name} in games DB for ${vod_id}`,
        });
      });
  };
};

module.exports.saveEmotes = function (app) {
  return async function (req, res, next) {
    const { vodId } = req.body;
    if (!vodId) return res.status(400).json({ error: true, msg: "No VodId" });

    emotes.save(vodId, app);
    res.status(200).json({ error: false, msg: "Saving emotes.." });
  };
};

module.exports.vodUpload = function (app) {
  return async function (req, res, next) {
    const { vodId, type } = req.body;
    if (!vodId) return res.status(400).json({ error: true, msg: "No vod id" });
    if (!type) return res.status(400).json({ error: true, msg: "No type" });

    res.status(200).json({
      error: false,
      msg: `Reuploading ${vodId} Vod`,
    });

    let videoPath = `${
      type === "live" ? config.livePath : config.vodPath
    }/${vodId}.mp4`;

    if (!(await fileExists(videoPath))) {
      if (config.drive.upload) {
        videoPath = await drive.download(vodId, type, app);
      } else {
        if (vodData.platform === "twitch") {
          videoPath = await vod.mp4Download(vodId);
        } else if (vodData.platform === "kick") {
          videoPath = await kick.downloadMP4(
            app,
            config.kick.username,
            game.vodId
          );
        }
      }
    }

    if (!videoPath)
      return console.error(
        `Could not find a download source for ${req.body.vodId}`
      );

    vod.manualVodUpload(app, vodId, videoPath, type);
  };
};

module.exports.gameUpload = function (app) {
  return async function (req, res, next) {
    const { vodId, type, chapterIndex } = req.body;
    if (!vodId) return res.status(400).json({ error: true, msg: "No vod id" });
    if (!type) return res.status(400).json({ error: true, msg: "No type" });
    if (chapterIndex == null)
      return res.status(400).json({ error: true, msg: "No chapter" });

    let vodData;
    await app
      .service("vods")
      .get(vodId)
      .then((data) => {
        vodData = data;
      })
      .catch(() => {});

    if (!vodData)
      return res.status(404).json({
        error: true,
        msg: "Vod does not exist",
      });

    const game = vodData.chapters[chapterIndex];
    if (!game)
      return res.status(404).json({
        error: true,
        msg: "Chapter does not exist",
      });

    res.status(200).json({
      error: false,
      msg: `Uploading ${chapter.name} from ${vodId} Vod`,
    });

    let videoPath = `${
      type === "live" ? config.livePath : config.vodPath
    }/${vodId}.mp4`;

    if (!(await fileExists(videoPath))) {
      if (config.drive.upload) {
        videoPath = await drive.download(game.vodId, type, app);
      } else {
        if (vodData.platform === "twitch") {
          videoPath = await vod.mp4Download(game.vodId);
        } else if (vodData.platform === "kick") {
          videoPath = await kick.downloadMP4(
            app,
            config.kick.username,
            game.vodId
          );
        }
      }
    }

    if (!videoPath)
      return console.error(
        `Could not find a download source for ${game.vodId}`
      );

    vod.manualGameUpload(
      app,
      vodData,
      {
        gameId: null,
        vodId: vodId,
        date: vodData.createdAt,
        chapter: game,
      },
      videoPath
    );
  };
};

module.exports.reuploadGame = function (app) {
  return async function (req, res, next) {
    const { gameId, type } = req.body;
    if (!gameId)
      return res.status(400).json({ error: true, msg: "No game id" });
    if (!type) return res.status(400).json({ error: true, msg: "No type" });

    let game;
    await app
      .service("games")
      .get(gameId)
      .then((data) => {
        game = data;
      })
      .catch(() => {});

    if (!game)
      return res.status(404).json({
        error: true,
        msg: "Game does not exist",
      });

    let vodData;
    await app
      .service("vods")
      .get(game.vodId)
      .then((data) => {
        vodData = data;
      })
      .catch(() => {});

    if (!vodData)
      return res.status(404).json({
        error: true,
        msg: "Vod does not exist",
      });

    res.status(200).json({
      error: false,
      msg: `Uploading ${game.game_name} from ${game.vodId} Vod`,
    });

    let videoPath = `${type === "live" ? config.livePath : config.vodPath}/${
      game.vodId
    }.mp4`;

    if (!(await fileExists(videoPath))) {
      if (config.drive.upload) {
        videoPath = await drive.download(game.vodId, type, app);
      } else {
        if (vodData.platform === "twitch") {
          videoPath = await vod.mp4Download(game.vodId);
        } else if (vodData.platform === "kick") {
          videoPath = await kick.downloadMP4(
            app,
            config.kick.username,
            game.vodId
          );
        }
      }
    }

    if (!videoPath)
      return console.error(
        `Could not find a download source for ${game.vodId}`
      );

    vod.manualGameUpload(
      app,
      vodData,
      {
        gameId: game.id,
        title: game.title,
        vodId: game.vodId,
        date: vodData.createdAt,
        chapter: {
          end: game.end_time,
          start: game.start_time,
          name: game.game_name,
        },
      },
      videoPath
    );
  };
};

const fileExists = async (file) => {
  return fs.promises
    .access(file, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false);
};
