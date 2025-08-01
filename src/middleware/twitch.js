const axios = require("axios");
const config = require("../../config/config.json");
const fs = require("fs");
const path = require("path");
const HLS = require("hls-parser");

module.exports.checkToken = async () => {
  await axios(`https://id.twitch.tv/oauth2/validate`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.twitch.auth.access_token}`,
    },
  })
    .then(() => true)
    .catch(async (e) => {
      if (e.response && e.response.status === 401) {
        console.info("Twitch App Token Expired");
        await this.refreshToken();
      }
      console.error(e.response ? e.response.data : e);
    });
};

module.exports.refreshToken = async () => {
  await axios
    .post(
      `https://id.twitch.tv/oauth2/token?client_id=${config.twitch.auth.client_id}&client_secret=${config.twitch.auth.client_secret}&grant_type=client_credentials`
    )
    .then((response) => {
      const data = response.data;
      config.twitch.auth.access_token = data.access_token;
      fs.writeFile(
        path.resolve(__dirname, "../../config/config.json"),
        JSON.stringify(config, null, 4),
        (err) => {
          if (err) return console.error(err);
          console.info("Refreshed Twitch App Token");
        }
      );
    })
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
    });
};

module.exports.getLiveTokenSig = async (vodID) => {
  const data = await axios({
    url: "https://gql.twitch.tv/gql",
    method: "POST",
    headers: {
      Accept: "*/*",
      "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko", //twitch's
      "Content-Type": "text/plain;charset=UTF-8",
    },
    data: {
      operationName: "PlaybackAccessToken",
      variables: {
        isLive: true,
        login: "",
        isVod: false,
        vodID: null,
        platform: "web",
        playerBackend: "mediaplayer",
        playerType: "site",
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash:
            "0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712",
        },
      },
    },
  })
    .then((response) => response.data.data.videoPlaybackAccessToken)
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });
  return data;
};

module.exports.getVodTokenSig = async (vodID) => {
  const data = await axios({
    url: "https://gql.twitch.tv/gql",
    method: "POST",
    headers: {
      Accept: "*/*",
      "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko", //twitch's
      "Content-Type": "text/plain;charset=UTF-8",
    },
    data: {
      operationName: "PlaybackAccessToken",
      variables: {
        isLive: false,
        login: "",
        isVod: true,
        vodID: vodID,
        platform: "web",
        playerBackend: "mediaplayer",
        playerType: "site",
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash:
            "0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712",
        },
      },
    },
  })
    .then((response) => response.data.data.videoPlaybackAccessToken)
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });
  return data;
};

module.exports.getM3u8 = async (vodId, token, sig) => {
  console.info(`GETTING M3u8 info from https://usher.ttvnw.net/vod/${vodId}.m3u8?allow_source=true&player=twitchweb&playlist_include_framerate=true&allow_spectre=true&nauthsig=${sig}&nauth=${token}`)
  const data = await axios
    .get(
      `https://usher.ttvnw.net/vod/${vodId}.m3u8?allow_source=true&player=mediaplayer&include_unavailable=true&supported_codecs=av1,h265,h264&playlist_include_framerate=true&allow_spectre=true&nauthsig=${sig}&nauth=${token}`
    )
    .then((response) => response.data)
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });
  return data;
};

module.exports.getParsedM3u8 = (m3u8) => {
  let parsedM3u8;
  try {
    parsedM3u8 = HLS.parse(m3u8);
  } catch (e) {
    console.error(e);
  }
  return parsedM3u8 ? parsedM3u8.variants[0].uri : null;
};

module.exports.getVariantM3u8 = async (M3U8_URL) => {
  const data = await axios
    .get(M3U8_URL)
    .then((response) => response.data)
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
    });
  return data;
};

module.exports.getLatestVodData = async (userId) => {
  await this.checkToken();
  const vodData = await axios
    .get(`https://api.twitch.tv/helix/videos?user_id=${userId}`, {
      headers: {
        Authorization: `Bearer ${config.twitch.auth.access_token}`,
        "Client-Id": config.twitch.auth.client_id,
      },
    })
    .then((response) => response.data.data[0])
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });
  return vodData;
};

module.exports.getVodData = async (vod_id) => {
  await this.checkToken();
  const vodData = await axios
    .get(`https://api.twitch.tv/helix/videos?id=${vod_id}`, {
      headers: {
        Authorization: `Bearer ${config.twitch.auth.access_token}`,
        "Client-Id": config.twitch.auth.client_id,
      },
    })
    .then((response) => response.data.data[0])
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });
  return vodData;
};

module.exports.getGameData = async (gameId) => {
  await this.checkToken();
  const gameData = await axios
    .get(`https://api.twitch.tv/helix/games?id=${gameId}`, {
      headers: {
        Authorization: `Bearer ${config.twitch.auth.access_token}`,
        "Client-Id": config.twitch.auth.client_id,
      },
    })
    .then((response) => response.data.data[0])
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });
  return gameData;
};

module.exports.fetchComments = async (vodId, offset = 0) => {
  const data = await axios({
    url: "https://gql.twitch.tv/gql",
    method: "POST",
    headers: {
      Accept: "*/*",
      "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko", //twitch's
      "Content-Type": "text/plain;charset=UTF-8",
    },
    data: {
      operationName: "VideoCommentsByOffsetOrCursor",
      variables: {
        videoID: vodId,
        contentOffsetSeconds: offset,
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash:
            "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a",
        },
      },
    },
  })
    .then((response) => response.data.data.video)
    .then((video) => {
      if (!video) return null;
      return video;
    })
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });
  return data;
};

module.exports.fetchNextComments = async (vodId, cursor) => {
  const data = await axios({
    url: "https://gql.twitch.tv/gql",
    method: "POST",
    headers: {
      Accept: "*/*",
      "Client-Id": "kd1unb4b3q4t58fwlpcbzcbnm76a8fp",
      "Content-Type": "text/plain;charset=UTF-8",
    },
    data: {
      operationName: "VideoCommentsByOffsetOrCursor",
      variables: {
        videoID: vodId,
        cursor: cursor,
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash:
            "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a",
        },
      },
    },
  })
    .then((response) => response.data.data.video)
    .then((video) => {
      if (!video) return null;
      return video;
    })
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });
  return data;
};

module.exports.getChapters = async (vodID) => {
  const data = await axios({
    url: "https://gql.twitch.tv/gql",
    method: "POST",
    headers: {
      Accept: "*/*",
      "Client-Id": "kd1unb4b3q4t58fwlpcbzcbnm76a8fp",
      "Content-Type": "text/plain;charset=UTF-8",
    },
    data: {
      operationName: "VideoPreviewCard__VideoMoments",
      variables: {
        videoId: vodID,
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash:
            "0094e99aab3438c7a220c0b1897d144be01954f8b4765b884d330d0c0893dbde",
        },
      },
    },
  })
    .then((response) => {
      if (!response.data.data.video) return null;
      if (!response.data.data.video.moments) return null;
      return response.data.data.video.moments.edges;
    })
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });
  return data;
};

module.exports.getChapter = async (vodID) => {
  const data = await axios({
    url: "https://gql.twitch.tv/gql",
    method: "POST",
    headers: {
      Accept: "*/*",
      "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko", //twitch's
      "Content-Type": "text/plain;charset=UTF-8",
    },
    data: {
      operationName: "NielsenContentMetadata",
      variables: {
        isCollectionContent: false,
        isLiveContent: false,
        isVODContent: true,
        collectionID: "",
        login: "",
        vodID: vodID,
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash:
            "2dbf505ee929438369e68e72319d1106bb3c142e295332fac157c90638968586",
        },
      },
    },
  })
    .then((response) => response.data.data.video)
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });
  return data;
};

module.exports.getStream = async (twitchId) => {
  await this.checkToken();
  const stream = await axios
    .get(`https://api.twitch.tv/helix/streams?user_id=${twitchId}`, {
      headers: {
        Authorization: `Bearer ${config.twitch.auth.access_token}`,
        "Client-Id": config.twitch.auth.client_id,
      },
    })
    .then((response) => response.data.data)
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });
  return stream;
};

module.exports.getChannelBadges = async () => {
  await this.checkToken();
  const badges = await axios
    .get(
      `https://api.twitch.tv/helix/chat/badges?broadcaster_id=${config.twitch.id}`,
      {
        headers: {
          Authorization: `Bearer ${config.twitch.auth.access_token}`,
          "Client-Id": config.twitch.auth.client_id,
        },
      }
    )
    .then((response) => response.data.data)
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });
  return badges;
};

module.exports.getGlobalBadges = async () => {
  await this.checkToken();
  const badges = await axios
    .get(`https://api.twitch.tv/helix/chat/badges/global`, {
      headers: {
        Authorization: `Bearer ${config.twitch.auth.access_token}`,
        "Client-Id": config.twitch.auth.client_id,
      },
    })
    .then((response) => response.data.data)
    .catch((e) => {
      console.error(e.response ? e.response.data : e);
      return null;
    });
  return badges;
};

module.exports.badges = function (app) {
  const _this = this;
  return async function (req, res, next) {
    const redisClient = app.get("redisClient");

    if (client) {
      const key = `${config.channel}-badges`;
      const cachedBadges = await redisClient
        .get(key)
        .then((data) => JSON.parse(data))
        .catch(() => null);

      if (cachedBadges) return res.json(cachedBadges);
    }

    let badges = {
      channel: await _this.getChannelBadges(),
      global: await _this.getGlobalBadges(),
    };

    if (!badges)
      return res.status(500).json({
        error: true,
        msg: "Something went wrong trying to retrieve channel badges..",
      });

    res.json(badges);

    if (client) {
      redisClient.set(key, JSON.stringify(badges), {
        EX: 3600,
      });
    }
  };
};
