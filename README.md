# Websocket Cache

simple websocket server

/room {token} {roomId}

/state {roomId} {state}

## Usage

node server.js --port 8080 --token

Options:
      --version  Show version number                                   [boolean]
  -p, --port     the port on which the Websocket Server will launch     [number]
  -t, --token    the token for authorization with the room service      [string]
      --help     Show help                                             [boolean]
