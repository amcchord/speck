//go:build windows

package agent

import (
	"context"
	"errors"
)

func remoteCapabilities() map[string]any {
	return map[string]any{"web_shell": false, "desktop": "unknown"}
}
func (c *Client) shell(context.Context, map[string]any) (map[string]any, error) {
	return nil, errors.New("interactive web shell requires a Linux agent")
}
